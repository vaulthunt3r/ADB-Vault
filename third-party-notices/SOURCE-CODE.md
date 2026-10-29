# Corresponding source for bundled tools

Windows releases include a small private Java runtime built with `jlink` from
**Eclipse Temurin 17.0.20.1+1**, Windows x64 HotSpot. It includes `java.base`,
`java.logging`, `java.xml`, `jdk.crypto.ec` and `jdk.zipfs`. ADB Vault does not
modify OpenJDK sources. The module licence texts remain under
`resources/inspector-tools/runtime/legal` in the application.

The **same GitHub Release** must provide
`OpenJDK17U-jdk-sources_17.0.20.1_1.tar.gz` alongside Setup and Portable. It is
the complete upstream source archive, not the Java-only `src.zip` from a JDK.
Its hash is listed in the release's `SHA256SUMS.txt`. The accompanying
`third-party-sources.json` records the upstream URL and verified SHA-256.

- [Exact upstream release](https://github.com/adoptium/temurin17-binaries/releases/tag/jdk-17.0.20.1%2B1)
- [Complete upstream source archive](https://github.com/adoptium/temurin17-binaries/releases/download/jdk-17.0.20.1%2B1/OpenJDK17U-jdk-sources_17.0.20.1_1.tar.gz)
- OpenJDK source revision: `79597447bd94` in `adoptium/jdk17u`.
- Temurin build recipe revision: `e6ba7dec3d07654074559310376a3ae89da5f4ac` in `adoptium/temurin-build`.
- ADB Vault's runtime assembly recipe is `scripts/build-inspector-tools.mjs`.
- Exact upstream runtime metadata is retained in `inspector-tools/JAVA-release.txt`.

Release preparation downloads the source and verifies its publisher-provided
checksum using `node scripts/prepare-java-source.mjs`. Do not omit this asset
when copying or mirroring the Windows release. Upgrading Java requires matching
updates to the runtime, source archive, hashes and this notice.

The detection databases have their own corresponding editable data and generator
scripts in `electron/data/app-manager/sources`; these are included in the
application under `resources/detection-databases/sources`. See that directory's
licences and revision manifest.
