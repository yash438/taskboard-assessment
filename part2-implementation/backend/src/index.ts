import { startServer } from './server';

// x-user-id identity is development-only (see ASSUMPTIONS.md).
if (process.env.NODE_ENV === 'production') {
  throw new Error('Header-based identity is for local development only; refusing to start in production.');
}

const { url } = await startServer(Number(process.env.PORT ?? 4000));
console.log(`Task board API ready at ${url}`);
