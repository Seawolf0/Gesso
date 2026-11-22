// @ts-check
/**
 * Redact credentials before anything is shown in #/debug or logged.
 * The live upload test showed what Canvas hands out:
 *   - upload_url …/files?token=<JWT>          (inst-fs upload token)
 *   - file url/preview_url …&verifier=<uuid>  (download without login)
 *   - S3-style upload_params (Signature, Policy, X-Amz-*)
 * Anything that would let someone else act on the user's behalf is
 * replaced with "[redacted]". Ids, names, sizes and plain URLs stay readable.
 */
(() => {
  const R = '[redacted]';

  /** Query parameters (and object keys) whose values are credentials. */
  const SECRET_KEYS = /^(token|access_token|verifier|signature|policy|x-amz-signature|x-amz-credential|x-amz-security-token|awsaccesskeyid|key-pair-id|sig|jwt|session|authenticity_token|_csrf_token|csrf_token|password|uuid|instfs_uuid)$/i;
  /** Keys inside an object that hold an upload signature bundle. */
  const SECRET_OBJECT_KEYS = /^(upload_params)$/i;

  /** Redact one string: credential query params, bearer tokens, bare JWTs. */
  function redactString(/** @type {string} */ s) {
    return s
      // ?token=…&verifier=… (also inside longer text), up to the next & # space or quote
      .replace(/([?&;](?:token|access_token|verifier|signature|policy|x-amz-signature|x-amz-credential|x-amz-security-token|awsaccesskeyid|key-pair-id|sig|jwt)=)[^&#\s"'<>]+/gi, `$1${R}`)
      .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/g, `$1${R}`)
      // A JWT anywhere (header.payload.signature, base64url)
      .replace(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, R);
  }

  /**
   * Deep copy with secrets redacted. Strings are scanned; values under
   * credential-named keys are replaced; `upload_params` keeps its key
   * names but not its values (except filename/content_type, which are
   * harmless and useful).
   * @param {any} value
   * @returns {any}
   */
  function redact(value, depth = 0) {
    if (depth > 20) return value;
    if (typeof value === 'string') return redactString(value);
    if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
    if (value && typeof value === 'object') {
      /** @type {Record<string, any>} */
      const out = {};
      for (const [k, v] of Object.entries(value)) {
        if (SECRET_KEYS.test(k) && v != null && v !== '') out[k] = R;
        else if (SECRET_OBJECT_KEYS.test(k) && v && typeof v === 'object') {
          out[k] = Object.fromEntries(Object.entries(v).map(([pk, pv]) => [pk, /^(filename|content_type|name)$/i.test(pk) ? pv : R]));
        } else out[k] = redact(v, depth + 1);
      }
      return out;
    }
    return value;
  }

  Gesso.redact = { redact, redactString, MARK: R };
})();
