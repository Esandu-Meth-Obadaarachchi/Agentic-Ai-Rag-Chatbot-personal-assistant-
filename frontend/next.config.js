/** @type {import('next').NextConfig} */
const nextConfig = {
  // Off deliberately: StrictMode's dev-only double mount rapidly
  // subscribes/unsubscribes Firestore listeners, which trips a known
  // WebChannel watch-stream assertion (ID b815/ca9). Production never ran
  // StrictMode's extra pass, so behaviour there is unchanged.
  reactStrictMode: false,
  experimental: {
    // Keep native/Node-only packages out of the client bundle. pdf-parse + mammoth
    // read the filesystem; the Pinecone client must stay server-side so
    // describeIndexStats() returns fresh namespace data.
    serverComponentsExternalPackages: [
      "pdf-parse",
      "mammoth",
      "@pinecone-database/pinecone",
      "firebase-admin",
    ],
  },
};

module.exports = nextConfig;
