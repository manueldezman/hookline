export default async function accountRoutes(app) {
  app.get('/v2/account', async (request, reply) => {
    reply.send({
      id: request.account.id,
      api_version: request.account.api_version,
    });
  });
}
