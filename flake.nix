{
  description = "NixPkgs PR Tracker development and CI environment";

  # 26.05 is shared across all four platforms; 26.11 dropped Intel macOS.
  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-26.05";

  outputs =
    { nixpkgs, ... }:
    let
      systems = [
        "aarch64-darwin"
        "x86_64-darwin"
        "aarch64-linux"
        "x86_64-linux"
      ];
      forAllSystems = nixpkgs.lib.genAttrs systems;
    in
    {
      devShells = forAllSystems (
        system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
          nodejs = pkgs.nodejs_22;
        in
        {
          default = pkgs.mkShell {
            packages = with pkgs; [
              nodejs
              python3
              imagemagick
              git
              gh
              gnupg
              actionlint
              nixfmt
              importNpmLock.hooks.linkNodeModulesHook
            ];

            # npm tarballs are fetched by Nix using package-lock.json's integrity hashes.
            # Only these two files affect node_modules, not unrelated source/doc changes.
            npmDeps = pkgs.importNpmLock.buildNodeModules {
              inherit nodejs;
              package = builtins.fromJSON (builtins.readFile ./package.json);
              packageLock = builtins.fromJSON (builtins.readFile ./package-lock.json);
            };
          };
        }
      );

      formatter = forAllSystems (system: nixpkgs.legacyPackages.${system}.nixfmt);
    };
}
