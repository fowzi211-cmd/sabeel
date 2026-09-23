/** One manual pass of the background jobs:   npm run jobs:run   (the server also runs them every minute). */
import { db } from "./lib/harness";
import { runJobsOnce } from "../src/server/jobs";

runJobsOnce()
  .then((r) => console.log(JSON.stringify(r, null, 2)))
  .finally(() => db.$disconnect());
