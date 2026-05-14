import { mkdir, writeFile } from "node:fs/promises";

const [version, sha256] = process.argv.slice(2);

if (!version || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
  throw new Error("Usage: bun scripts/update-homebrew-cask.mjs <semver-version> <sha256>");
}

if (!sha256 || !/^[a-f0-9]{64}$/i.test(sha256)) {
  throw new Error("Expected a 64-character SHA-256 checksum.");
}

const cask = `cask "k100s" do
  version "${version}"
  sha256 "${sha256.toLowerCase()}"

  url "https://github.com/AndrewVos/k100s/releases/download/v#{version}/k100s-#{version}-mac.dmg",
      verified: "github.com/AndrewVos/k100s/"
  name "k100s"
  desc "Kubernetes desktop browser for clusters, namespaces, pods, and logs"
  homepage "https://github.com/AndrewVos/k100s"

  livecheck do
    url :url
    strategy :github_latest
  end

  auto_updates false

  app "k100s.app"

  uninstall quit: "com.andrewvos.k100s"

  zap trash: [
    "~/Library/Application Support/k100s",
    "~/Library/Caches/com.andrewvos.k100s",
    "~/Library/Logs/k100s",
    "~/Library/Preferences/com.andrewvos.k100s.plist",
    "~/Library/Saved Application State/com.andrewvos.k100s.savedState",
  ]

  caveats <<~EOS
    This build is not notarized yet. If macOS blocks launch, run:

      xattr -dr com.apple.quarantine /Applications/k100s.app
  EOS
end
`;

await mkdir("Casks", { recursive: true });
await writeFile("Casks/k100s.rb", cask);
