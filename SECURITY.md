# Security Policy

## Sensitive Data

Do not commit real secrets or private data to this repository.

Keep these files and directories local:

- `.env`
- `storage/`
- `1panel-local-app/`
- `ai-image-web-studio-1panel-local-app.zip`
- database backups
- generated images
- reference images
- real provider API keys

Use `.env.example` as the public configuration template.

## Reporting Security Issues

Please open a private security advisory on GitHub if available, or contact the project maintainer privately. Do not publish exploitable details in a public issue before a fix is available.

## Deployment Notes

- Change `AUTH_SECRET` before production use.
- Store provider API keys only in environment variables or the encrypted Key pool inside the application.
- Rotate any key that may have been shared in chat logs, screenshots, commits, or public issue reports.
