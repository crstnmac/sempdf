/**
 * Public guard-registration API (`@sempdf/sempdf-pdf/license-guard`).
 *
 * The core library calls the installed guard immediately before serializing a
 * document, so an external package — e.g. a private licensing client — can meter,
 * watermark, or block generation without the core depending on it. When no
 * guard is installed, generation is refused unless the development bypass is
 * enabled.
 *
 * This is the only surface a licensing package needs from the core library;
 * the client implementation itself lives outside this package.
 */
export {
  setLicenseGuard,
  getLicenseGuard,
  getLicenseInstallChallenge,
  setLicenseGuardWithProof,
  type LicenseInstallProof,
  consumeLicense,
  isLicenseDevBypass,
  licenseQuotaError,
  shutdownAutoGuard,
  checkout,
  ensureLicenseAuthorized,
  flushLicenseUsage,
  setJobContext,
  type LicenseGuard,
  type LicenseGuardDecision,
  type GenerationUsage,
  type JobContext,
} from "./internal/license-guard.js";
