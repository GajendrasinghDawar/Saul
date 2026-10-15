# S3-backed chat attachments

## What is stored

File bytes and file metadata are stored in a private S3-compatible bucket.
Saul does not write uploaded files to its server disk. It reads each file into
bounded memory for upload, download, or a model request.

Chat history contains file IDs, names, media types, and sizes. It contains no
uploaded file body, base64 image, public object URL, or signed URL that can expire.
The existing snapshot stream sends these references to web and Android.

The files belong to the authenticated account. An object key includes the
account ID and a random file ID. The client cannot choose an object key. A
different account cannot download or send another account's file. Files can be
used again in chats owned by the same account, including a fork of a chat.

## Configure storage

Create a private bucket with your S3 provider. Block public access. Give Saul a
dedicated credential with `s3:PutObject` and `s3:GetObject` access to
`saul/attachments/*` in that bucket. Metadata checks use `GetObject` headers and
close the response body without buffering it. This supports services that
permit GET but reject HEAD. Saul does not need bucket creation, listing,
deletion, or public ACL permissions.

Set these environment variables in the untracked root `.env` file or your
deployment secret manager. Storage is not editable through client Settings:

| Setting | Value |
| --- | --- |
| `S3_ENDPOINT` | HTTPS service endpoint, not an object URL |
| `S3_REGION` | Provider signing region; default `us-east-1`; R2 normally uses `auto` |
| `S3_BUCKET` | Private bucket name |
| `S3_ACCESS_KEY_ID` | Dedicated server access key ID |
| `S3_SECRET_ACCESS_KEY` | Dedicated server secret key |

Restart the backend after saving these settings. The client uses path-style
requests so custom S3 endpoints do not need bucket subdomains. HTTPS is required
in production. HTTP loopback endpoints are permitted for local development only.

Old S3 database overrides are retained but ignored. Configure their working
values externally before upgrading; Saul does not export or delete credentials.
S3 configuration does not use `SAUL_SECRETS_KEY` (that key still protects AI
overrides). Bootstrap and database credentials remain outside the UI. No bucket or external
credential is provisioned by this feature. Until the required S3 values are set,
uploads are disabled and text chat remains available.

Do not change the endpoint or bucket as a shortcut for moving files. Existing
references will still need the original objects. Copy the objects with their
keys and metadata before switching storage. Credential replacement also requires
a backend restart; keep the old credential valid until that restart completes.

## Formats and limits

* Up to four different files per message.
* PNG, JPEG, and WebP images: nonempty, at most 5 MiB each.
* UTF-8 plain text, Markdown, CSV, and JSON: nonempty, at most 64 KiB each.
* Image signatures must match the declared media type. Text must be valid UTF-8
  and must not contain null bytes. These checks are not a malware scanner or a
  full image decoder.
* PDF, office documents, audio, and video are not supported in this slice.
  Unsupported files return an explicit error. They are not sent as URLs or
  silently omitted from the model request.
* The active model context has a 20 MiB file-body limit. The model's own token
  and image limits still apply. Use a new chat for large collections of files.

The provider catalog controls image support. Unknown Azure deployment names
default to text only. For a custom deployment that actually supports images,
set `AZURE_OPENAI_INPUT` to `text,image` and restart. `text` forces text-only
input. Removing this override restores the provider catalog default. The flag
does not add image support to a model that lacks it.

## Message trace

1. The client uploads a file through authenticated `POST /api/artifacts`.
2. Saul validates the file and stores it in S3 under a new account-scoped key.
3. The server returns `{id,name,mimeType,size}`.
4. The client sends these IDs with text through `POST /api/chat`.
5. Saul reads canonical metadata from S3 and checks ownership and model support.
6. Pi-Durable persists small references with the user message.
7. Before each model request, including a recovered request, the attachment
   extension fetches the referenced files from S3. It makes a new request
   context with actual text and base64 image parts. It does not change the
   stored transcript.
8. Web and Android receive the references through the existing snapshot stream.

Storage errors stop request preparation rather than sending an incomplete
message to the model. A rejected send keeps the draft and uploaded references.
A lost network reply can still mean the message was accepted. Check the
transcript before sending again. There is no offline send queue or automatic
retry. Draft references are not retained across a page reload or app process
death.

Pi's current compaction hook cannot replace the context used to make a history
summary. The attachment extension declines summaries that would remove file
references without reading the files. Start a new chat if the history becomes
too large. Text-only history without file references keeps its normal behavior.

Web offers authenticated downloads. Android saves an authenticated download
to a location selected with the system document picker. The upload picker shows
all files because document providers report different types for text formats;
the app normalizes supported filename extensions and the server checks bytes.
Uploaded files are never rendered as active HTML. Web downloads use attachment
disposition, `nosniff`, and `Cache-Control: no-store`.

## Server replacement and backups

S3 survives replacement of the application server. This does not make all Saul
state disposable. The account database stores account IDs and ownership. Pi's
SQLite database stores chat history and execution checkpoints. Keep both on
persistent storage, with tested backups. The current deployment uses one
backend process and a persistent `data` volume; do not run several Pi instances
against the same SQLite file.

Restore the account database, Pi database, object storage, and external
encryption key together. Creating a new account with the same email does not
restore the old account ID or access to its object keys.

No file is deleted when a draft is removed or a conversation is deleted. This
prevents deletion of a file still used by a fork. Unused-upload cleanup and
account-wide storage quotas need a separate retention design. Do not apply a
bucket rule that expires all attachments while their chats still exist.

## Local checks and release limits

Run `node --test server/test/attachments.test.ts` for the S3 HTTP fixture checks.
These checks use the real SDK, but the object service is an in-memory fixture.
They do not prove a provider's bucket policy, credential permissions, or uptime.
Verify an upload, a model request, a download, and a restart against the chosen
provider before using this in production. Do not use paid model requests in
deterministic tests.
