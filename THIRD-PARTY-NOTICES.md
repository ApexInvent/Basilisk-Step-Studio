# Third-party notices

Basilisk Step Studio is licensed under the GNU General Public License v3 or later. See
[LICENSE](LICENSE).

This file lists third-party software distributed with it. Licence texts are in
[`licenses/`](licenses/) and in `engine/licenses/` for the components that ship with the
engine. All third-party components are redistributed unmodified.

This software makes use of facilities provided by Open CASCADE Technology.

---

## stl2step

    Version      v1.2.0
    Licence      MIT
    Source       https://github.com/BlinkingSun/stl2step
    Text         licenses/stl2step-MIT.txt
    Files        engine/stl2step.exe

Compiled from upstream source against Open CASCADE Technology 7.9.3 by
[.github/workflows/engine.yml](.github/workflows/engine.yml).

---

## Open CASCADE Technology

    Version      7.9.3
    Licence      GNU LGPL v2.1, with the Open CASCADE exception version 1.0
    Copyright    Copyright (c) OPEN CASCADE SAS
    Source       https://github.com/Open-Cascade-SAS/OCCT
    Binaries     conda-forge package occt 7.9.3 novtk
    Text         licenses/LGPL-2.1.txt, licenses/OCCT-exception.txt
    Files        engine/TK*.dll (24 files)

The libraries are dynamically linked and distributed as separate DLL files beside the
executable, so they may be replaced with another build of the same version. Corresponding
source for version 7.9.3 is available from the address above.

---

## Libraries distributed with Open CASCADE Technology

Required at runtime by the kernel. Licence texts for each are in `engine/licenses/`, harvested
from the upstream packages at build time.

| Component | Files | Licence |
| --- | --- | --- |
| FreeImage | `FreeImage.dll` | FreeImage Public License, or GPL v2, or GPL v3 |
| OpenEXR | `OpenEXR.dll`, `OpenEXRCore.dll`, `Iex.dll`, `IlmThread.dll` | BSD 3-Clause |
| Imath | `Imath.dll` | BSD 3-Clause |
| LibRaw | `raw.dll` | LGPL v2.1, or CDDL v1.0, or the LibRaw Software License |
| FreeType | `freetype.dll` | FreeType License, or GPL v2 |
| libtiff | `tiff.dll` | libtiff licence |
| libpng | `libpng16.dll` | PNG Reference Library License |
| libjpeg-turbo | `jpeg8.dll` | BSD 3-Clause, IJG |
| libwebp | `libwebp.dll`, `libwebpmux.dll`, `libsharpyuv.dll` | BSD 3-Clause |
| OpenJPEG | `openjp2.dll` | BSD 2-Clause |
| OpenJPH | `openjph.dll` | BSD 2-Clause |
| Little CMS | `lcms2.dll` | MIT |
| zlib | `zlib.dll`, `deflate.dll` | zlib licence |
| Zstandard | `zstd.dll` | BSD 3-Clause, or GPL v2 |
| xz | `liblzma.dll` | 0BSD, public domain |
| LERC | `Lerc.dll` | Apache License 2.0 |

---

## Microsoft Visual C++ runtime

    Licence      Microsoft Visual Studio distributable licence terms
    Files        MSVCP140.dll, VCRUNTIME140.dll, VCRUNTIME140_1.dll,
                 api-ms-win-crt-*.dll (11 files)

Distributed under the Visual Studio redistributable terms. These are System Libraries within
the meaning of section 1 of the GNU General Public License v3.

---

## Application dependencies

Compiled into the application bundle.

| Component | Licence |
| --- | --- |
| Vue | MIT |
| Vue Router | MIT |
| Pinia | MIT |
| three.js | MIT |
| Tauri, and its API and plugin packages | Apache License 2.0, or MIT |
| Oswald | SIL Open Font License 1.1 |
| Figtree | SIL Open Font License 1.1 |
| IBM Plex Mono | SIL Open Font License 1.1 |

The complete pinned dependency sets are in [package-lock.json](package-lock.json) and
[src-tauri/Cargo.lock](src-tauri/Cargo.lock). Rust dependencies are predominantly MIT or
Apache License 2.0.

---

## Trademarks

The Basilisk Step Studio name, logo and icon are trademarks of Apex Invent and are not
licensed under the GNU General Public License v3 grant covering the source code.
