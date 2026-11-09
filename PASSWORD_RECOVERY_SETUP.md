# Researcher password recovery

The archive sign-in form has a Forgot password button. A researcher enters their email; Supabase sends a recovery link; the linked reset page verifies the recovery session and accepts a new password. The account UUID and annotation access remain unchanged. There is no public signup flow.

## Required Supabase configuration

In **Authentication → URL Configuration**, add this exact address to **Redirect URLs**:

```
https://sourasky-dhlab.github.io/shamanism/reset-password.html
```

Set the Site URL to the archive's public address if it is still a localhost placeholder:

```
https://sourasky-dhlab.github.io/shamanism/
```

Keep the default reset-password email template using `{{ .ConfirmationURL }}`. The implementation uses the browser implicit recovery flow and expects a verified `type=recovery` access token in the URL fragment. Custom templates that send a raw OTP, token hash or PKCE code need a corresponding callback implementation; they are not handled by this page.

## Email delivery

Configure a custom SMTP sender in Supabase Authentication email settings for researchers outside your Supabase organization's team. Supabase's default mail service only delivers to project-organization team addresses and has restrictive testing limits. Creating a researcher Auth account or adding them to the archive's allowlist does not add them to that organization team. Do not add researchers as project administrators just to receive password emails; configure SMTP instead.

No SMTP passwords or service-role keys belong in the repository. Enter email-service credentials directly into Supabase.

## Acceptance test

1. On the deployed archive, click Forgot password and enter your own research account's email. Only request mail for an account you control during testing.
2. Open the delivered link. The address should become `/shamanism/reset-password.html` without a token in the address bar.
3. Choose and confirm a password of at least eight characters, satisfying any stronger rules configured in the project.
4. Return to the archive and sign in with the new password. Verify that existing notes, tags and researcher permissions are intact.
5. An expired or missing reset link should display an error and no password form. Request a fresh link if necessary; reloading the reset page clears its in-memory recovery session.

The reset callback verifies the token through Supabase before showing the form, changes the password through the Auth API, attempts to revoke refresh sessions, clears the current tab's archive session, and asks the researcher to sign in again. Existing access tokens can remain valid until they expire. Tokens/passwords are not logged or persisted by the reset page.

## Automated checks

`node --test tests/password-recovery.test.cjs` checks parsing, password confirmation and request construction. `python tests/password-recovery-browser.py` exercises the complete mocked browser flow without sending email or changing real accounts. GitHub CI runs these alongside existing research and pagination regressions. These do not verify the live project's redirect allowlist, SMTP delivery, email templates or password policies; complete the acceptance test after configuring Supabase.

References: [Supabase password recovery](https://supabase.com/docs/guides/auth/passwords), [custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp).
