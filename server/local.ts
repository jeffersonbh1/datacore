import 'dotenv/config';
import { app } from './app';

const port = Number(process.env.PORT) || 8787;

app.listen(port, () => {
  console.log(`API local do DataCore rodando em http://localhost:${port}`);
});
