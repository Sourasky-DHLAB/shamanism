import importlib.util
import os
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('backup', Path(__file__).resolve().parents[1] / 'tools/backup_supabase.py')
b = importlib.util.module_from_spec(spec)
spec.loader.exec_module(b)


class BackupTests(unittest.TestCase):
    def test_session_pooler_requires_correct_project_and_tls(self):
        url = f'postgresql://postgres.{b.PROJECT}:fake-password@aws-0-eu.pooler.supabase.com:5432/postgres'
        self.assertIn('sslmode=require', b.connection_url(url + '?sslmode=disable'))
        for bad in (url.replace(':5432', ':6543'), url.replace(b.PROJECT, 'other'), url.replace('.pooler.supabase.com', '.example.com')):
            with self.assertRaises(ValueError) as error:
                b.connection_url(bad)
            self.assertNotIn('fake-password', str(error.exception))

    def test_dump_validation_includes_history_and_auth(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / 'roles.sql').write_text('-- roles')
            (root / 'schema.sql').write_text('\n'.join(f'CREATE TABLE "public"."{t}" (id int);' for t in b.TABLES) + '\nsave_research_annotation rename_research_tag')
            data = '\n'.join(f'COPY "public"."{t}" (id) FROM stdin;' for t in b.TABLES)
            (root / 'data.sql').write_text(data + '\nCOPY auth.users (id) FROM stdin;')
            b.validate_dumps(root)
            (root / 'data.sql').write_text(data)
            with self.assertRaises(RuntimeError):
                b.validate_dumps(root)

    def test_failed_commands_do_not_expose_output(self):
        result = subprocess.CompletedProcess([], 1, b'private rows', b'password=private')
        with patch.object(b.subprocess, 'run', return_value=result):
            with self.assertRaises(RuntimeError) as error:
                b.command(['unused'], 'Export')
        self.assertNotIn('private', str(error.exception))

    def test_public_media_bucket_is_rejected_before_aws_call(self):
        with patch.object(b, 'aws') as aws:
            with self.assertRaises(ValueError):
                b.check_bucket('shamanism-media-054037119136-us-east-1-an', '123')
            aws.assert_not_called()

    def test_public_bucket_configuration_is_rejected(self):
        with patch.object(b, 'aws', return_value={'PublicAccessBlockConfiguration': {}}):
            with self.assertRaises(RuntimeError):
                b.check_bucket('private-test-bucket', '123')

    def test_encrypted_upload_round_trip_with_fixture_database(self):
        real_command = b.command
        state = {}
        def command(args, label, *rest, **kwargs):
            if args[:2] == ['aws', 'sts']:
                return b'{"Account":"123456789012"}'
            if args[0] == 'supabase':
                path = Path(args[args.index('-f') + 1])
                content = '-- fixture roles'
                if path.name == 'schema.sql':
                    content = '\n'.join(f'CREATE TABLE public.{t} (id int);' for t in b.TABLES) + '\nsave_research_annotation rename_research_tag'
                if path.name == 'data.sql':
                    content = '\n'.join(f'COPY public.{t} (id) FROM stdin;' for t in b.TABLES) + '\nCOPY auth.users (id) FROM stdin;'
                path.write_text(content)
                return b''
            return real_command(args, label, *rest, **kwargs)
        def aws(operation, *args):
            if operation == 'put-object':
                path = Path(args[args.index('--body') + 1])
                state['checksum'] = args[args.index('--checksum-sha256') + 1]
                state['size'] = path.stat().st_size
                self.assertNotIn(b'COPY auth.users', path.read_bytes())
                return {'ChecksumSHA256': state['checksum']}
            return {'ChecksumSHA256': state['checksum'], 'ContentLength': state['size']}
        with tempfile.TemporaryDirectory() as temp:
            env = {'SUPABASE_DB_URL': f'postgresql://postgres.{b.PROJECT}:fixture@aws-0-test.pooler.supabase.com:5432/postgres',
                   'BACKUP_ENCRYPTION_PASSPHRASE': 'fixture-only-password-long-enough', 'BACKUP_BUCKET': 'private-fixture-bucket',
                   'GNUPGHOME': temp, 'GITHUB_STEP_SUMMARY': ''}
            with patch.dict(os.environ, env), patch.object(b, 'command', side_effect=command), patch.object(b, 'aws', side_effect=aws), patch.object(b, 'check_bucket'):
                b.main()
        self.assertGreater(state['size'], 0)


if __name__ == '__main__':
    unittest.main()
