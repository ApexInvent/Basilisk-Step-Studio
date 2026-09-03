# Third party notices

Basilisk Step Studio is licensed under the GNU General Public License v3, in [LICENSE](LICENSE).
This file covers the other people's work that it is built on and, in the case of the installer,
redistributes.

Everything below is a record of what ships and under what terms. It is not legal advice. If
this is ever sold, or bundled into something else that is, the combination is worth a proper
review, particularly the OpenCASCADE and FreeImage terms.

---

## The converter

**stl2step**, by BlinkingSun. MIT.
<https://github.com/BlinkingSun/stl2step>

All STL to STEP conversion is performed by stl2step. Basilisk Step Studio provides the Windows
interface around it and does no geometry work of its own.

The installer bundles a Windows build of stl2step compiled from upstream source at tag `v1.2.0`
against OpenCASCADE 7.9.3. The workflow that produces it is in
[.github/workflows/engine.yml](.github/workflows/engine.yml), so the build is reproducible from
this repository.

---

## The geometry kernel

**Open CASCADE Technology 7.9.3.** GNU Lesser General Public License version 2.1, with the
Open CASCADE exception.
<https://dev.opencascade.org/> and <https://github.com/Open-Cascade-SAS/OCCT>

This is the one that carries real obligations, because **the installer redistributes it**.
Twenty four `TK*.dll` files, roughly 47 MB, are included so the engine runs on a machine with
nothing else installed. Upstream stl2step does not bundle OCCT and notes that distributors of
linked binaries should review its licence. That note applies to this project.

The OCCT libraries are dynamically linked and shipped as separate DLL files beside the
executable, so they can be replaced with another build of the same version. Source for the
exact version used is available from the OpenCASCADE project at the addresses above.

The binaries are the prebuilt conda-forge `occt 7.9.3 novtk` package, not a modified build. No
changes were made to OpenCASCADE.

---

## Libraries OpenCASCADE depends on

These ship alongside the kernel because it will not start without them. All are redistributed
unmodified.

| Library | Licence |
| --- | --- |
| FreeImage | FreeImage Public License, or GPL v2, or GPL v3 |
| OpenEXR, Imath, Iex, IlmThread | BSD 3-Clause |
| LibRaw (`raw.dll`) | LGPL 2.1, or CDDL 1.0, or the LibRaw Software License |
| FreeType | FreeType License, or GPL v2 |
| libtiff | libtiff (BSD style) |
| libpng | PNG Reference Library License |
| libjpeg-turbo (`jpeg8.dll`) | BSD 3-Clause and IJG |
| libwebp, libsharpyuv, libwebpmux | BSD 3-Clause |
| OpenJPEG (`openjp2.dll`) | BSD 2-Clause |
| OpenJPH | BSD 2-Clause |
| Little CMS (`lcms2.dll`) | MIT |
| zlib, deflate | zlib licence |
| Zstandard | BSD 3-Clause, or GPL v2 |
| xz (`liblzma.dll`) | 0BSD and public domain |
| LERC | Apache 2.0 |

FreeImage and Zstandard are dual licensed with a GPL option, and LibRaw offers LGPL 2.1, so
each can be taken under terms compatible with this project's GPL v3.

---

## Microsoft Visual C++ runtime

`MSVCP140.dll`, `VCRUNTIME140.dll`, `VCRUNTIME140_1.dll` and the `api-ms-win-crt-*` files are
Microsoft redistributables, included so the engine runs without a separate runtime install.
They are covered by the Visual Studio distributable licence terms and are System Libraries
within the meaning of section 1 of the GPL v3.

---

## The interface

Compiled into the application bundle:

| Dependency | Licence |
| --- | --- |
| Vue | MIT |
| Vue Router | MIT |
| Pinia | MIT |
| three.js | MIT |
| Tauri, and its API and plugin packages | Apache 2.0, or MIT |
| Oswald, Figtree and IBM Plex Mono, via Fontsource | SIL Open Font License 1.1 |

The Rust dependencies of the desktop shell are predominantly MIT or Apache 2.0. The full set,
pinned, is in [src-tauri/Cargo.lock](src-tauri/Cargo.lock), and the JavaScript set is in
[package-lock.json](package-lock.json).

The three typefaces are redistributed under the SIL Open Font License, which permits bundling
and requires that the licence travel with the fonts. Their licence files are included in the
Fontsource packages.

---

## The logo

The Basilisk Step Studio name, logo and icon are trademarks of Apex Invent and are not covered
by the GPL grant on the source. Forks are free to use the code and should use their own name
and mark.
