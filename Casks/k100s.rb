cask "k100s" do
  version "0.1.3"
  sha256 "c5cb9b9f02dd296b19c93c272596017efa55f3917cce46ba016271d22a06fc25"

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
