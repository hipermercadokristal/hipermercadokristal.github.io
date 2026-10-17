# Android APK

GitHub Actions publishes the customer APK at `/downloads/hipermercado-kristal.apk`
and the delivery APK at `/downloads/kristal-reparto.apk`. The delivery package
opens `https://hipermercadokristal.github.io/delivery/`; the customer package
opens `https://hipermercadokristal.github.io/`. Both are Trusted Web Activity
wrappers.
Android removes the browser toolbar only when the APK signing certificate is
verified by the website's Digital Asset Links file.

## Configure a persistent signing key

Create a PKCS#12 key store with Java's `keytool` (Android Studio includes a
Java runtime). Use the alias `kristal`, choose a strong password, and keep a
secure backup of the keystore:

```powershell
keytool -genkeypair -v -keystore kristal-release.p12 -storetype PKCS12 -alias kristal -keyalg RSA -keysize 2048 -validity 10000
[Convert]::ToBase64String([IO.File]::ReadAllBytes("$PWD\kristal-release.p12")) | Set-Clipboard
```

In the repository's GitHub settings, open **Secrets and variables → Actions**,
create these repository secrets, and paste their values:

- `ANDROID_KEYSTORE_BASE64`: the Base64 value copied by the PowerShell command.
- `ANDROID_KEYSTORE_PASSWORD`: the keystore password (use the same password
  when `keytool` asks for the key password).

Do not commit or share the `.p12` file or its password. On the next deployment,
GitHub Actions will sign a release APK and generate
`/.well-known/assetlinks.json` using that certificate's SHA-256 fingerprint.
After confirming that file is publicly reachable, uninstall the previous
debug-signed beta from Android before installing the release APK.

On Android, the Reparto page offers its dedicated APK download. On the store,
if Chrome does not provide its native PWA install prompt, the website's
“Instalar app” button downloads the customer APK instead. The user must
confirm installation and allow the browser to install apps from that source.
Until the signing secrets are configured, CI publishes a debug APK; it will
continue to display the browser toolbar because its temporary certificate
cannot be verified by the website.
