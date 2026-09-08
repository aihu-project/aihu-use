# Release contract

The package release workflow is deliberately gated. A release starts from an
exact stable `vX.Y.Z` tag on the default branch and the tag must point to the
workflow commit. The version in `package.json`, the tag, and the captured
tarball must agree.

CI installs with `npm install --ignore-scripts` and invokes the build explicitly.
The release job checks project, configured user, default user, and global npmrc
files plus environment variables for classic auth settings. It then uses npm
trusted publishing with GitHub OIDC (`id-token: write`), provenance, and no
`setup-node` registry token. The target version must return HTTP 404 from the
public npm registry before publish; any other response fails closed.

`verify:pack` captures one exact allowlisted tarball and verifies its manifest,
exports, dependencies, peer ranges, and files. `consumer:smoke` installs that
same archive in an isolated temporary project with scripts disabled and imports
the public entrypoints. The release workflow publishes only after these checks.
