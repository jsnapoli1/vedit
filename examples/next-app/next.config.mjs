/** @type {import('next').NextConfig} */
export default {
  reactStrictMode: true,
  // The example lives inside the library's own repo, so Next would otherwise
  // walk up and pick the library's lockfile as the workspace root.
  outputFileTracingRoot: import.meta.dirname,
}
