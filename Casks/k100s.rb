cask "k100s" do
  version "0.1.1"
  sha256 "726d0ed5c7cf7a7ca7355f19295440e031196cefd7ae2238f60aace4f85ef43e"

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
