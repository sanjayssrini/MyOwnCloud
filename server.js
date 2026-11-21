import { createServer } from "node:http";
import { parse } from "node:url";
import next from "next";
import { getLanIp } from "./lib/network.js";
import { ensureCurrentHostAuthorized } from "./lib/firebase-domains.js";

const isProduction = process.env.NODE_ENV === "production" || process.argv.includes("--prod");
const dev = !isProduction;
const port = parseInt(process.env.PORT || "3000", 10);
const hostname = "0.0.0.0";

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(async () => {
  const networkIp = getLanIp();

  // Auto-authorize current network IP in Firebase dynamically
  await ensureCurrentHostAuthorized(networkIp);

  const server = createServer(async (req, res) => {
    try {
      const parsedUrl = parse(req.url, true);
      await handle(req, res, parsedUrl);
    } catch (err) {
      console.error("Error occurred handling", req.url, err);
      res.statusCode = 500;
      res.end("Internal Server Error");
    }
  });

  // Optimize for large file transfers: disable socket timeouts
  server.timeout = 0;
  server.requestTimeout = 0;
  server.keepAliveTimeout = 65000;
  server.headersTimeout = 66000;

  server.listen(port, hostname, () => {
    console.log("");
    console.log("  MyOwnCloud is ready:");
    console.log(`  ➜  Local:   http://localhost:${port}`);
    if (networkIp && networkIp !== "127.0.0.1") {
      console.log(`  ➜  Network: http://${networkIp}:${port}`);
    }
    console.log("");
  });
});
