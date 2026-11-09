# Private database backups

The workflow exports this project's roles, schema and data, including researcher accounts, annotations and revision history. It encrypts the archive with GPG before uploading it to a separate private S3 bucket. It verifies a local decryption round trip and the uploaded checksum. No database export is stored in GitHub or its artifacts.

**Installation alone does not create a backup. Scheduled runs stay disabled until you enable them.**

## 1. Create the private AWS resources

Download `infrastructure/database-backup.yaml` from this repository. In AWS CloudFormation, select your region (for example `us-east-1`), choose **Create stack → With new resources**, and upload the template. Name the stack `shamanism-database-backups`.

Leave `CreateGitHubOIDCProvider` as `true` unless IAM → Identity providers already contains `token.actions.githubusercontent.com`; in that case choose `false`. Acknowledge creation of IAM resources and create the stack.

The template creates a new bucket with public access blocked, HTTPS required, encryption and a 30-day expiration rule. It does not use or modify the archive's media bucket. The GitHub role can read the backup bucket's safety settings and upload/read backup objects; it cannot delete objects or change bucket policies. Its trust is restricted to this repository's main branch. AWS storage and request charges apply.

## 2. Configure GitHub Actions

In this repository open **Settings → Secrets and variables → Actions**.

Under **Variables**, add:

| Name | Value |
| --- | --- |
| `BACKUP_BUCKET` | CloudFormation Outputs: `BackupBucketName` |
| `AWS_BACKUP_ROLE_ARN` | Outputs: `BackupRoleArn` |
| `AWS_REGION` | Outputs: `BackupRegion` |
| `DB_BACKUPS_ENABLED` | `false` initially |

Under **Secrets**, add:

| Name | Value |
| --- | --- |
| `SUPABASE_DB_URL` | Supabase **Connect → Session pooler** PostgreSQL URI, with the database password inserted and URL-encoded |
| `BACKUP_ENCRYPTION_PASSPHRASE` | A newly generated random password of at least 32 characters, on one line |

Use the Session pooler on port **5432**, username `postgres.utwwjzpzreoumchytpzk`, database `postgres`. The script enforces TLS. The publishable API key cannot replace the database password. Never paste either secret into chat, repository files, issues or workflow inputs.

Keep the encryption passphrase in an independent password manager/offline record. Losing it makes the backups unusable. Retain previous passphrases until backups encrypted with them have expired. Update the DB URL secret after changing your database password.

## 3. Make the first backup

Open **Actions → Private Supabase database backup → Run workflow**, selecting `main`. Check that the run succeeds and that its summary identifies an encrypted `.tar.gz.gpg` object. In the new S3 bucket, verify that object exists under `supabase/utwwjzpzreoumchytpzk/`.

A green run verifies export structure, encryption round trip and upload integrity. It does **not** prove that a full database restore will succeed.

## 4. Verify restoration before enabling the schedule

Use a disposable Supabase project, never the working research database. Download one encrypted object privately. With GPG installed, decrypt it (GPG prompts for the encryption passphrase):

```sh
gpg --output database.tar.gz --decrypt downloaded-backup.tar.gz.gpg
tar -xzf database.tar.gz
```

Compare each SQL file's SHA-256 with `manifest.json`. Follow Supabase's current [backup and restore instructions](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore) to restore roles, schema and data into the disposable project. Use `ON_ERROR_STOP` and a transaction; disable replication triggers during the data restore as instructed there so the annotation-history trigger does not create additional revisions. Supabase-managed roles and schemas require the documented restore procedure, rather than importing into an empty generic PostgreSQL server.

Check researcher UUIDs and allowlist rows, annotation text/tags, revision history, row counts, research functions and RLS permissions. Confirm authorized researchers can access their research data and unauthorized users cannot. Keep decrypted exports private and remove temporary copies after testing.

## 5. Enable daily backups

After the first backup and restore check succeed, change the GitHub variable `DB_BACKUPS_ENABLED` to `true`. The workflow runs daily at **02:17 UTC** (04:17 Israel winter time; 05:17 summer time). GitHub schedules can be delayed. Enable Actions failure notifications and periodically verify recent objects exist. GitHub can disable scheduled workflows in inactive public repositories, so check the Actions page if backups stop.

S3 lifecycle expiration is asynchronous. Versioning is enabled; noncurrent versions expire after 30 days as well, so a replaced/deleted object's old version can remain longer than 30 days from its original creation. Deleting the CloudFormation stack retains the bucket and its data.

## Scope and limitations

This is a logical database export, not a backup of the entire Supabase service. AWS media files, Supabase Storage object contents, project settings, SMTP/provider configuration, API keys and encryption/Vault root keys are separate. Custom login-role passwords may require separate restoration. This application uses AWS for its archived media.

Avoid database schema changes during the export: roles, schema and data are separate export steps. A paused or unreachable project produces a failed run. Review Supabase usage/egress and AWS charges. No live production backup or restore is verified merely by running the automated code tests.
