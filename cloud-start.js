// HEZZUZ Cloud Ready — Discloud
// O modo de nuvem deve ser definido antes de importar os modulos do bot.
process.env.HEZZUZ_CLOUD_MODE = "discloud";

// Nao utilizar --no-compile: a Discloud pode iniciar sem os artefatos dist/.
// O index.js original compila automaticamente quando necessario.
require("./index.js");
