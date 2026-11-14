#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
console.log(`external-demo script OK — ejecutado desde ${here}`);
