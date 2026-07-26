# Native OCR resources

The Windows bundle contains `tesseract.exe` and every DLL from the validated
local Tesseract 5 runtime. Import it with:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/import-ocr-runtime.ps1
```

The current imported runtime is Tesseract `5.4.0.20240606`. Its executable
and complete DLL set are recorded with SHA-256 hashes in
`ocr-runtime-manifest.json`; the build verifier checks every entry.

The three `tessdata/*.traineddata` files are pinned to official
`tesseract-ocr/tessdata_fast` commit
`87416418657359cb625c412a48b6e1d6d41c29bd`:

- `ara`: `e3206d3dc87fd50c24a0fb9f01838615911d25168f4e64415244b67d2bb3e729`
- `eng`: `7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2`
- `fra`: `ced037562e8c80c13122dece28dd477d399af80911a28791a66a63ac1e3445ca`

The importer does not overwrite these three language models. It also imports
the Tesseract configuration files required for TSV output. The application
never downloads binaries or language files at runtime.

The book assistant is hidden in `tauri dev` by default. For an explicit local
test only, start the Vite/Tauri development build with:

```text
VITE_ENABLE_BOOK_ASSISTANT_IN_TAURI_DEV=true
```

This override is ignored by production builds, never enables the feature in a
browser, and still requires the native OCR runtime to be available.
