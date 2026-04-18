import { handlePagesRequest } from "../../src/server/pages-api.js";

export default function onRequest(context) {
  return handlePagesRequest(context);
}
