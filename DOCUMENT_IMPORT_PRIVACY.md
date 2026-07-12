# Privacy-first bank document import

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

Hashing is pseudonymisation, not anonymisation: a document hash remains protected workspace metadata. Access is restricted by RLS.

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
