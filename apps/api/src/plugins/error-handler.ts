import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import { STATUS_CODES } from "node:http";

interface ErrorResponse {//this defines the shape of the error response
  statusCode: number;
  error: string;
  message: string;
}

// eslint-disable-next-line @typescript-eslint/require-await -- FastifyPluginAsync requires async signature
const errorHandler: FastifyPluginAsync = async (app) => {
  //this tells fastify whenver an error happens in a request send it through this function
  app.setErrorHandler((error: unknown, request, reply) => {//here unknown is used,its imp to check its importance here
    const errorStatusCode =
      typeof error === "object" &&
      error !== null &&
      "statusCode" in error &&
      typeof error.statusCode === "number"
        ? error.statusCode//agr yeah 4 condn true higa tabhi true hoga nahi to undefined kar denge=>this is type narrowing
        : undefined;

    // Prefer the error's status, then a status already set on the reply, else 500.
    let statusCode = 500;
    if (errorStatusCode !== undefined && errorStatusCode >= 400 && errorStatusCode < 600) {
      statusCode = errorStatusCode;
    } else if (reply.statusCode >= 400 && reply.statusCode < 600) {
      statusCode = reply.statusCode;
    }

    const isClientError = statusCode < 500;
    const statusText = STATUS_CODES[statusCode] ?? "Error";

    if (isClientError) {
      request.log.warn({ err: error }, "Client error");
    } else {
      request.log.error({ err: error }, "Unhandled server error");
    }

    const response: ErrorResponse = {
      statusCode,
      error: statusText,
      message: isClientError
        ? error instanceof Error && error.message
          ? error.message
          : statusText
        : "Internal Server Error",
    };

    return reply.status(statusCode).send(response);
  });
};

// fastify-plugin skips encapsulation, so this handler applies to the whole app
// (including routes registered in other plugins), not just this plugin's scope.
export default fp(errorHandler, {
  name: "error-handler",
  fastify: "5.x",
});
