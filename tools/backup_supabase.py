"""Encrypted logical backup of the research database to a private S3 bucket.

Run only from the main-branch backup workflow. Never prints dump contents or secrets.
"""
import base64
import hashlib
import json
import os
import re
import subprocess
import tarfile
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
from uuid import uuid4

PROJECT = 'utwwjzpzreoumchytpzk'
PREFIX = f'supabase/{PROJECT}/'
TABLES = ('researchers', 'research_annotations', 'research_annotation_history')

def connection_url(value):
    try:
        parsed = urlsplit(value)
        valid = (parsed.scheme in ('postgres', 'postgresql')
                 and (parsed.hostname or '').endswith('.pooler.supabase.com')
                 and parsed.port == 5432
                 and parsed.username == f'postgres.{PROJECT}'
                 and bool(parsed.password) and parsed.path == '/postgres')
    except ValueError:
        valid = False
    if not valid:
        raise ValueError('SUPABASE_DB_URL must be this project’s Session pooler URL on port 5432, with a database password.')
    query = dict(parse_qsl(parsed.query))
    if query.get('sslmode') not in ('require', 'verify-ca', 'verify-full'):
        query['sslmode'] = 'require'
    return urlunsplit(parsed._replace(query=urlencode(query)))

def command(args, label, input_bytes=None, timeout=600):
    try:
        result = subprocess.run(args, input=input_bytes, stdout=subprocess.PIPE,
                                stderr=subprocess.PIPE, timeout=timeout, check=False)
    except (OSError, subprocess.TimeoutExpired):
        raise RuntimeError(f'{label} could not complete. Check the setup instructions.') from None
    if result.returncode:
        # CLI output can contain connection strings, passwords or database content.
        raise RuntimeError(f'{label} failed. No dump or command output has been printed. Check credentials, network access and configuration.')
    return result.stdout

def aws(operation, *args):
    output = command(['aws', 's3api', operation, *args, '--no-cli-pager', '--output', 'json'], f'S3 {operation}')
    return json.loads(output or b'{}')

def check_bucket(bucket, owner):
    if not re.fullmatch(r'[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]', bucket):
        raise ValueError('Set BACKUP_BUCKET to the private bucket created by the backup stack.')
    if bucket == 'shamanism-media-054037119136-us-east-1-an':
        raise ValueError('The public archive-media bucket must not hold database backups.')
    flags = ['--bucket', bucket, '--expected-bucket-owner', owner]
    block = aws('get-public-access-block', *flags).get('PublicAccessBlockConfiguration', {})
    if not all(block.get(k) is True for k in ('BlockPublicAcls', 'IgnorePublicAcls', 'BlockPublicPolicy', 'RestrictPublicBuckets')):
        raise RuntimeError('All four S3 Block Public Access settings must be enabled.')
    if aws('get-bucket-policy-status', *flags).get('PolicyStatus', {}).get('IsPublic') is not False:
        raise RuntimeError('The backup bucket policy must not be public.')
    encryption = aws('get-bucket-encryption', *flags).get('ServerSideEncryptionConfiguration', {}).get('Rules', [])
    if not any(r.get('ApplyServerSideEncryptionByDefault', {}).get('SSEAlgorithm') == 'AES256' for r in encryption):
        raise RuntimeError('The dedicated bucket must use default SSE-S3 encryption.')
    rules = aws('get-bucket-lifecycle-configuration', *flags).get('Rules', [])
    if not any(r.get('Status') == 'Enabled' and r.get('Expiration', {}).get('Days') == 30
               and r.get('Filter', {}).get('Prefix', r.get('Prefix', '')) == PREFIX for r in rules):
        raise RuntimeError('The backup prefix must have the configured 30-day lifecycle rule.')

def validate_dumps(directory):
    for name in ('roles.sql', 'schema.sql', 'data.sql'):
        path = directory / name
        if not path.is_file() or path.stat().st_size == 0:
            raise RuntimeError('A required backup file is empty or missing.')
    schema = (directory / 'schema.sql').read_text().replace('"', '')
    data = (directory / 'data.sql').read_text().replace('"', '')
    for table in TABLES:
        if not re.search(r'CREATE TABLE(?: IF NOT EXISTS)?\s+public\.' + table + r'\s*\(', schema, re.I):
            raise RuntimeError('Research table definitions are missing from the schema backup.')
    for name in tuple('public.' + t for t in TABLES) + ('auth.users',):
        if not re.search(r'COPY\s+' + re.escape(name) + r'\s*\(', data, re.I):
            raise RuntimeError('Research rows, revision history, or authentication data are missing from the data backup.')
    for function in ('save_research_annotation', 'rename_research_tag'):
        if function not in schema:
            raise RuntimeError('Research write functions are missing from the schema backup.')

def sha256(path):
    digest = hashlib.sha256()
    with path.open('rb') as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()

def main():
    db_url = connection_url(os.environ.get('SUPABASE_DB_URL', ''))
    passphrase = os.environ.get('BACKUP_ENCRYPTION_PASSPHRASE', '')
    if len(passphrase) < 24 or '\n' in passphrase or '\r' in passphrase:
        raise ValueError('Set a single-line BACKUP_ENCRYPTION_PASSPHRASE of at least 24 characters; retain an offline copy.')
    bucket = os.environ.get('BACKUP_BUCKET', '')
    owner = json.loads(command(['aws', 'sts', 'get-caller-identity', '--output', 'json'], 'AWS identity check'))['Account']
    check_bucket(bucket, owner)
    os.umask(0o077)
    with tempfile.TemporaryDirectory(prefix='supabase-backup-', dir=os.environ.get('RUNNER_TEMP')) as scratch:
        directory = Path(scratch)
        stages = [
            ('roles.sql', ['--role-only']),
            ('schema.sql', []),
            ('data.sql', ['--data-only', '--use-copy', '-x', 'storage.buckets_vectors', '-x', 'storage.vector_indexes'])
        ]
        for name, flags in stages:
            command(['supabase', 'db', 'dump', '--remote=' + db_url, '-f', str(directory / name), *flags], f'{name} database export')
        validate_dumps(directory)
        stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
        manifest = {'project': PROJECT, 'created_at': stamp, 'format': 'supabase-cli-logical-v1',
                    'files': {name: sha256(directory / name) for name, _ in stages}}
        (directory / 'manifest.json').write_text(json.dumps(manifest, indent=2))
        packed = directory / 'database.tar.gz'
        with tarfile.open(packed, 'w:gz') as archive:
            for name in ('roles.sql', 'schema.sql', 'data.sql', 'manifest.json'):
                archive.add(directory / name, arcname=name)
        encrypted = directory / 'database.tar.gz.gpg'
        key_input = (passphrase + '\n').encode()
        command(['gpg', '--batch', '--yes', '--pinentry-mode', 'loopback', '--passphrase-fd', '0',
                 '--cipher-algo', 'AES256', '--compress-algo', 'none', '--symmetric',
                 '--output', str(encrypted), str(packed)], 'Backup encryption', key_input)
        verified = directory / 'verified.tar.gz'
        command(['gpg', '--batch', '--yes', '--pinentry-mode', 'loopback', '--passphrase-fd', '0',
                 '--output', str(verified), '--decrypt', str(encrypted)], 'Encryption round-trip check', key_input)
        if sha256(verified) != sha256(packed):
            raise RuntimeError('Encrypted backup failed the local decryption round-trip check.')
        digest = sha256(encrypted)
        checksum = base64.b64encode(bytes.fromhex(digest)).decode()
        object_key = f'{PREFIX}{stamp}-{uuid4().hex}.tar.gz.gpg'
        uploaded = aws('put-object', '--bucket', bucket, '--key', object_key, '--body', str(encrypted),
                       '--expected-bucket-owner', owner, '--server-side-encryption', 'AES256',
                       '--checksum-algorithm', 'SHA256', '--checksum-sha256', checksum,
                       '--metadata', 'sha256=' + digest)
        remote = aws('head-object', '--bucket', bucket, '--key', object_key,
                     '--expected-bucket-owner', owner, '--checksum-mode', 'ENABLED')
        if (remote.get('ChecksumSHA256') != checksum or remote.get('ContentLength') != encrypted.stat().st_size
                or uploaded.get('ChecksumSHA256') != checksum):
            raise RuntimeError('S3 checksum or size verification failed. The uploaded copy has not been marked successful.')
        print('Encrypted backup uploaded and its S3 checksum verified.')
        if os.environ.get('GITHUB_STEP_SUMMARY'):
            with open(os.environ['GITHUB_STEP_SUMMARY'], 'a') as summary:
                summary.write(f'## Database backup succeeded\nUTC snapshot: {stamp}\n\nRoles, schema, research data/history and Auth users included. Encryption round-trip and S3 checksum verified.\n\nObject: `{object_key}`\n')

if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        # Known errors above contain no secret values; never print subprocess output.
        if isinstance(error, (ValueError, RuntimeError)):
            print(str(error))
        else:
            print('Backup failed. Review configuration; no sensitive output has been printed.')
        raise SystemExit(1)
