# FinTrack GLM-OCR gateway

This service is the primary receipt OCR path. It keeps `GLM-OCR-Q8_0` loaded in
`llama-server`, validates the Supabase session and active workspace membership,
and returns transient OCR text. It does not store files, filenames or OCR text.

## Deploy

1. Put these files on the VPS:
   - `GLM-OCR-Q8_0.gguf`
   - `mmproj-GLM-OCR-Q8_0.gguf`
2. Copy `.env.example` to `.env` and fill the public Supabase URL/key and model
   directory. The public key is used only to validate the user's bearer token;
   the service-role key is neither required nor accepted.
3. Start the permanently warm model and gateway:

   ```sh
   docker compose up -d --build
   ```

4. Terminate TLS in Caddy/Nginx and proxy a dedicated HTTPS hostname to
   `127.0.0.1:8788`. Never expose the `glm-ocr` container or port 8080.
5. Set `VITE_RECEIPT_OCR_URL=https://ocr.example.com` in Vercel and redeploy.

`GET /health` is ready only after `llama-server` has loaded both GGUF files.
The container restart policy keeps the model warm independently of frontend
page loads. On a CPU-only VPS, configure threads close to the number of physical
cores; do not run multiple model slots unless RAM and latency have been measured.

## Privacy and security

- Accepted bodies are signed JPG, PNG and WEBP images up to 15 MB.
- Every request needs a current Supabase access token plus an active Owner,
  Admin or Member role in the selected workspace. The membership query runs
  under the user's own JWT and existing RLS; Viewer cannot consume OCR capacity.
- Allowed browser origins are explicit. Rate limits are per authenticated user.
- Image bytes and raw OCR text remain in memory only for the request. Request
  bodies and upstream responses must not be logged by the reverse proxy.
- The model is self-hosted. No receipt is sent to OpenRouter or another AI API.
