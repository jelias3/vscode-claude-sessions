#!/bin/bash
# Build the extension into one .vsix file, which VS Code can install.
#
# A .vsix is a zip holding three things: a manifest in the form VS Code reads,
# a table of content types, and the extension under extension/. No network and
# no package manager are needed, so this runs on midway3 as it is.
#
#   tools/build_vsix.sh        the file lands in build/

set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE="$HERE/extension"
BUILD="$HERE/build"
STAGE="$BUILD/stage"

NAME=$(python3 -c "import json;print(json.load(open('$SOURCE/package.json'))['name'])")
PUBLISHER=$(python3 -c "import json;print(json.load(open('$SOURCE/package.json'))['publisher'])")
VERSION=$(python3 -c "import json;print(json.load(open('$SOURCE/package.json'))['version'])")
ENGINE=$(python3 -c "import json;print(json.load(open('$SOURCE/package.json'))['engines']['vscode'])")
DESCRIPTION=$(python3 -c "import json;print(json.load(open('$SOURCE/package.json'))['description'])")
TARGET="$BUILD/$PUBLISHER.$NAME-$VERSION.vsix"

rm -rf "$STAGE"
mkdir -p "$STAGE/extension"
cp -r "$SOURCE"/. "$STAGE/extension/"
# VS Code shows a README on the details page of the extension. It takes the
# one this project already has, so there is never a second copy to go stale.
cp "$HERE/README.md" "$STAGE/extension/README.md"

cat > "$STAGE/[Content_Types].xml" <<XML
<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="json" ContentType="application/json"/>
  <Default Extension="js" ContentType="application/javascript"/>
  <Default Extension="md" ContentType="text/markdown"/>
  <Default Extension="vsixmanifest" ContentType="text/xml"/>
</Types>
XML

cat > "$STAGE/extension.vsixmanifest" <<XML
<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011">
  <Metadata>
    <Identity Language="en-US" Id="$NAME" Version="$VERSION" Publisher="$PUBLISHER"/>
    <DisplayName>Claude Code status</DisplayName>
    <Description xml:space="preserve">$DESCRIPTION</Description>
    <Tags>claude</Tags>
    <GalleryFlags>Public</GalleryFlags>
    <Properties>
      <Property Id="Microsoft.VisualStudio.Code.Engine" Value="$ENGINE"/>
      <Property Id="Microsoft.VisualStudio.Code.ExtensionDependencies" Value=""/>
      <Property Id="Microsoft.VisualStudio.Code.ExtensionPack" Value=""/>
      <Property Id="Microsoft.VisualStudio.Code.ExtensionKind" Value="workspace"/>
      <Property Id="Microsoft.VisualStudio.Code.LocalizedLanguages" Value=""/>
    </Properties>
  </Metadata>
  <Installation>
    <InstallationTarget Id="Microsoft.VisualStudio.Code"/>
  </Installation>
  <Dependencies/>
  <Assets>
    <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true"/>
    <Asset Type="Microsoft.VisualStudio.Services.Content.Details" Path="extension/README.md" Addressable="true"/>
  </Assets>
</PackageManifest>
XML

rm -f "$TARGET"
(cd "$STAGE" && zip -q -r -X "$TARGET" "[Content_Types].xml" extension.vsixmanifest extension)
rm -rf "$STAGE"
echo "$TARGET"
