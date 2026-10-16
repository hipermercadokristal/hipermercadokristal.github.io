# Android beta APK

GitHub Actions builds a debug-signed Android APK and publishes it at
`/downloads/hipermercado-kristal.apk` with the website. The APK is a Trusted Web
Activity wrapper around `https://hipermercadokristal.github.io/`; Android
launches the site using the installed browser.

This beta uses Android's automatically generated debug signing key. It is for
direct testing and is not a Google Play release. Each clean CI build can use a
different debug key, so uninstall an older beta before installing a newly built
APK. A production release needs a persistent private signing key and a Digital
Asset Links entry for the website.

On Android, if Chrome does not provide its native PWA install prompt, the
website's “Instalar app” button downloads this APK instead. The user must
confirm installation and allow the browser to install apps from that source.
