import { httpRouter } from "convex/server";
import { options, receive } from "./uploadHttp";

const http = httpRouter();
http.route({ path: "/uploads", method: "OPTIONS", handler: options });
http.route({ path: "/uploads", method: "POST", handler: receive });
export default http;
