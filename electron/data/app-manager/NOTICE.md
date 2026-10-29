# Detection databases — third-party material

These files are redistributed unmodified from App Manager:
https://github.com/MuntashirAkon/AppManager

The exact commit, upstream file paths and SHA-256 digests are in manifest.json.
The initial bundled revision is 2d9223a7a541ad40ec927e429d7a9ab58d27a90d.

* trackers.xml, libs.xml, native_libs.xml: GPL-3.0-or-later, as declared in their SPDX headers. Full licence: GPL-3.0.txt.
* debloat.json, suggestions.json: generated from Android Debloat List, AGPL-3.0-or-later. Full licence: AGPL-3.0.txt.

The original editable data and generation scripts are available at:
* https://github.com/MuntashirAkon/AppManager/blob/2d9223a7a541ad40ec927e429d7a9ab58d27a90d/scripts/update_libraries.php
* https://github.com/MuntashirAkon/AppManager/blob/2d9223a7a541ad40ec927e429d7a9ab58d27a90d/scripts/make_debloat_list.php
* https://github.com/MuntashirAkon/android-libraries
* https://github.com/MuntashirAkon/android-debloat-list

Credits include App Manager, Muntashir Al-Islam, IzzyOnDroid, Exodus Privacy, ETIP, Android Debloat List and their contributors. ETIP-only tracker labels retain the upstream ² marker. No warranty is provided for classifications or detection completeness.

These datasets retain their own licences; the project's MIT licence does not relicense them. Data is kept separate from the independently implemented ADB Vault collectors and matching engine. Updated snapshots retain their source manifest and these notices. No APKs or installed application lists are sent to these sources.

The sources/ directory contains the corresponding original library and debloat source data plus the generation scripts for the bundled snapshot. sources/sources.json records their repository revisions. Source files retain their SPDX/COPYING licences.
