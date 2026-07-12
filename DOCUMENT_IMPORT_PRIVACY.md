# Privacy-first bank document import

## ADR-001: P1 receipt evidence is local recognition, not file attachment storage

- **Status:** Accepted
- **Date:** 12 July 2026
- **Decision owner:** FinTrackApp product and engineering

### Context

The original P1 wording, “receipt attachments and photos”, could be read as a requirement to upload and retain original files. Receipts commonly contain personal and payment data, while the P1 user need is to turn a receipt into a reviewable financial operation and retain useful redacted line-item context. Persisting originals would add a storage lifecycle, access-control, malware-handling, deletion and incident-response surface that is not needed for that outcome.

### Decision

For P1, the accepted receipt scope is **privacy-first local recognition**:

- the user may select a receipt PDF/image or capture a photo;
- extraction, OCR, parsing and redaction run in the current browser tab;
- the original file, image/PDF bytes, original filename and raw OCR text are not uploaded to or stored by FinTrackApp;
- only user-confirmed normalized operation fields, an optional user-editable redacted receipt-item comment, a SHA-256 document hash, row fingerprints and minimal import audit metadata may be persisted;
- closing or reloading the tab discards the original and raw recognition data held in browser memory.

This is an explicit P1 scope decision. “Receipt support” in P1 does **not** mean a downloadable attachment, a server-side receipt archive or retention of an original image/PDF. If original-file storage is required later, it must be proposed as a separate ADR with encryption, RLS, retention/deletion, malware scanning, export and incident-response requirements before implementation.

### Consequences

- P1 can satisfy receipt capture and recognition without creating a repository of sensitive originals.
- Users must keep originals outside FinTrackApp when they need them for accounting, tax or legal evidence.
- FinTrackApp cannot display or download an original receipt after import; it can show only the confirmed operation and optional redacted item comment.
- A document hash is pseudonymous workspace metadata and remains protected by RLS.

## Supported samples

The implementation was developed against the local fixtures in `artifacts/import_test` without copying them into the repository or uploading them to a service.

- Kaspi consumer statement PDF: text layer, multi-page, KZT transactions.
- Freedom Bank statement PDF: text layer, multi-page, KZT and USD transactions.
- Kaspi and Freedom receipt PDFs: single operation.
- Kaspi payment/transfer screenshots: local Russian/English OCR.
- Kaspi card statement screenshot: table OCR with lower confidence.
- Halyk and Kaspi business account screenshots: accepted, but low-quality table OCR may require manual correction or a PDF/CSV source.
- Scanned PDF without a text layer: local OCR fallback, up to five pages per file.
- A JSON file incorrectly named `.pdf`: rejected by file-signature validation.

## Data lifecycle

1. The browser checks size, extension and binary signature.
2. PDF text extraction and OCR run locally in the browser. Tesseract language models may be downloaded, but document bytes are not sent with that request.
3. Raw text is parsed in memory and is not placed in React state, Local Storage, Supabase Storage, logs or analytics.
4. IIN/BIN, IBAN, cards, phone numbers, email, receipt references and labelled names are redacted before descriptions or receipt-item comments reach the draft.
5. The user reviews and edits every draft row and the optional extracted item comment. Duplicate candidates are disabled by default.
6. Only confirmed normalized operations and the edited item comment are written to Postgres.
7. Import audit stores source type, bank, counts, SHA-256 document hash and row fingerprints. It never stores the original filename, file or OCR text.
8. A category rule is saved only after an explicit “remember category” choice. It contains a normalized description fragment, operation type and category ID—not the source document or full OCR text.

Hashing is pseudonymisation, not anonymisation: a document hash remains protected workspace metadata. Access is restricted by RLS.

## P1 acceptance criteria and evidence

P1 receipt recognition is accepted when all of the following are true:

1. File selection is unavailable until the user acknowledges local processing and masking.
2. PDF/image extraction and OCR execute in the browser; no request contains the selected document bytes, original filename or raw OCR text.
3. Sensitive identifiers are redacted before an operation draft or receipt-item comment is displayed or persisted.
4. Every detected row remains an editable draft; incomplete receipts are not silently confirmed, and duplicate candidates are disabled by default.
5. Persistence is limited to confirmed normalized operations, an optional edited/redacted item comment, hashes/fingerprints and minimal import audit metadata.
6. The database has no P1 column or object-storage path for an original receipt, filename or raw OCR text.
7. Reloading or closing the tab removes the selected original and raw OCR text; a later session can retrieve only persisted normalized/redacted data.

Automated evidence:

- `npm test -- test/documentImport.test.js` covers receipt parsing, incomplete editable drafts, sensitive-data redaction and redacted receipt-item extraction.
- `supabase/tests/atomic_imports_test.sql` verifies that confirmed receipt-item comments are committed atomically with operations; database migrations constrain import audit to metadata and comments to redacted/user-edited text.
- `npm run verify` is the release gate for lint, the unit suite and a production build.

Manual release evidence (record browser/build version and result in the release checklist):

1. Open DevTools **Network**, clear requests, select a uniquely named receipt image, complete recognition and confirm the draft. Verify that no request payload contains the file bytes, unique filename or a distinctive unredacted OCR phrase. Requests for Tesseract language/model assets are allowed only when they contain no document data.
2. Verify in the preview and saved operation that seeded IIN/BIN, IBAN/card, phone/email, receipt reference and labelled name values are absent or masked.
3. Inspect `import_sessions`, `operations` and `operation_comments` for the test import: only the documented metadata, normalized operation and optional edited/redacted item comment may exist. Verify that no receipt object appears in Supabase Storage.
4. Reload the page and confirm that the original image/PDF and raw OCR text cannot be viewed or downloaded from FinTrackApp.

## Security and privacy rationale

- Data minimisation and short retention follow privacy-by-design/default guidance.
- Local processing avoids unnecessary disclosure to OCR or generative AI providers.
- Explicit acknowledgement makes the processing purpose and limitations visible before file selection.
- Allowlisted formats, size limits and binary-signature validation implement defence in depth for untrusted files.
- The parser never executes embedded PDF actions, follows QR/receipt URLs or renders uploaded active content back to other users.

References:

- European Commission, data protection by design and default: https://commission.europa.eu/law/law-topic/data-protection/rules-business-and-organisations/obligations/what-does-data-protection-design-and-default-mean_en
- ICO, pseudonymisation and data minimisation: https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/data-sharing/anonymisation/pseudonymisation/
- OWASP File Upload Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html
