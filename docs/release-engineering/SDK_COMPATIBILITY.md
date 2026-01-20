# SDK Backward-Compatibility Policy (AC-PR1.9)

This document defines the versioning and deprecation policy for the `@robopoker/client` TypeScript SDK.

## Semantic Versioning (SemVer)

The SDK follows strict [Semantic Versioning 2.0.0](https://semver.org/):

```
MAJOR.MINOR.PATCH
```

### Version Increments

| Change Type | Example | Version Bump |
|-------------|---------|--------------|
| Breaking API change | Remove function | MAJOR |
| Account layout change (incompatible) | Change struct fields | MAJOR |
| New feature (backward compatible) | Add new function | MINOR |
| Bug fix | Fix incorrect behavior | PATCH |
| New account type | Add new account parser | MINOR |
| Performance improvement | Optimize parsing | PATCH |

### Breaking Changes (MAJOR)

A MAJOR version bump is required for:

1. **Removed exports**
   - Removing any public function, type, or constant
   - Removing any exported interface/type

2. **Changed function signatures**
   - Adding required parameters
   - Changing parameter types (narrowing)
   - Changing return types

3. **Account layout changes**
   - Modifying existing field offsets
   - Changing field types
   - Removing fields

4. **Behavioral changes**
   - Different error types thrown
   - Changed transaction building logic

### Non-Breaking Changes (MINOR/PATCH)

- Adding new optional parameters (MINOR)
- Adding new exports (MINOR)
- Adding new account types (MINOR)
- Fixing bugs in existing behavior (PATCH)
- Performance improvements (PATCH)
- Documentation updates (no version change)

## Deprecation Policy

### Deprecation Timeline

1. **v(N).0.0** - Feature marked `@deprecated` with JSDoc
2. **v(N+1).0.0** - Deprecation warning logged at runtime (if possible)
3. **v(N+2).0.0** - Feature may be removed

Minimum deprecation window: **2 major versions** or **6 months**, whichever is longer.

### Deprecation Annotation

```typescript
/**
 * @deprecated Use `createTableV2` instead. Will be removed in v3.0.0.
 * @see createTableV2
 */
export function createTable(...) { ... }
```

### Migration Guides

For each deprecated feature, provide:
- Reason for deprecation
- Recommended replacement
- Code example showing migration
- Link to relevant changelog entry

## Compatibility Matrix

The SDK maintains compatibility with:

| Component | Minimum Supported | Recommended |
|-----------|-------------------|-------------|
| Node.js | 18.x | 20.x LTS |
| TypeScript | 5.0 | 5.3+ |
| @solana/kit | 5.0.0 | Latest |
| Program version | See below | Latest |

### Program-SDK Compatibility

| Program Version | SDK Versions |
|-----------------|--------------|
| v1.x (mainnet)  | ^1.0.0       |
| v2.x (future)   | ^2.0.0       |

SDK versions are coupled to on-chain program versions. A new program version that changes account layouts requires a corresponding SDK major version bump.

## Release Process

### Pre-Release Checklist

1. [ ] All breaking changes documented in CHANGELOG.md
2. [ ] Deprecation warnings added for removed features
3. [ ] Migration guide written if needed
4. [ ] TypeScript types updated
5. [ ] Unit tests pass
6. [ ] Integration tests against devnet pass
7. [ ] Package.json version bumped correctly

### Release Procedure

```bash
# 1. Update version
npm version major|minor|patch

# 2. Update changelog
# Edit CHANGELOG.md with release notes

# 3. Build and test
npm run build
npm run test

# 4. Publish
npm publish

# 5. Create GitHub release with changelog
gh release create v$(node -p "require('./package.json').version")
```

### Post-Release

1. Update documentation site
2. Announce in relevant channels
3. Monitor for integration issues

## Changelog Format

Follow [Keep a Changelog](https://keepachangelog.com/):

```markdown
# Changelog

## [Unreleased]

## [2.0.0] - YYYY-MM-DD

### Added
- New `subscribeToTable` function for real-time updates

### Changed
- **BREAKING**: `createTable` now requires `entropyProgramId` parameter
- Improved error messages for transaction failures

### Deprecated
- `parseTable` - use `decodeTable` instead (removal in v4.0.0)

### Removed
- **BREAKING**: `legacyCreateTable` (deprecated in v1.0.0)

### Fixed
- Fixed race condition in `joinTable`

### Security
- Updated dependencies to patch CVE-XXXX-XXXX
```

## Integration Support

### Support Timeline

| SDK Version | Support Status | End of Support |
|-------------|----------------|----------------|
| v1.x        | Active         | 6 months after v2.0.0 |
| v0.x        | Deprecated     | Unsupported    |

### Backport Policy

Security fixes are backported to:
- Current major version
- Previous major version (for 6 months after current release)

Feature additions are NOT backported.

## SDK Consumer Guidelines

### Recommended package.json

```json
{
  "dependencies": {
    "@robopoker/client": "^1.0.0"
  }
}
```

Using `^` allows minor and patch updates automatically.

### Pinning Strategy

For production applications, consider:
- Using lockfiles (package-lock.json)
- Testing updates in staging before production
- Subscribing to release notifications

### Handling Breaking Changes

1. Read the CHANGELOG for the new version
2. Follow the migration guide
3. Update your code
4. Test thoroughly before deployment
