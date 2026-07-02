/**
 * Test preload (`node --test --import`): installs a permissive guard on the
 * verified path so the suite generates watermark-free output, the way a
 * licensed customer would. Individual tests (license-guard.test.ts) clear or
 * replace the guard to exercise unverified / bypass / blocked behavior.
 *
 * This imports the internal module directly — possible only from inside this
 * repo; the package `exports` map hides it from consumers.
 */
import { setVerifiedLicenseGuard } from "../src/internal/license-guard.js";

setVerifiedLicenseGuard({ consume() {} });
