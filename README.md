<img width="2501" height="948" alt="Carregando" src="https://github.com/user-attachments/assets/9f48eb7a-45ad-4983-ae2b-860b61dc29df" />
<img width="2480" height="942" alt="Tela inicial" src="https://github.com/user-attachments/assets/c77c13c4-cdfe-429e-b1b8-8fbf5481b5c4" />
# CineHome Pro 🎬
### Personal Media Streaming Server

O **CineHome Pro** é uma plataforma de streaming autohospedada que transforma seu computador em um servidor de mídia inteligente. Desenvolvido com foco em performance e interface premium, ele permite catalogar, buscar metadados automaticamente e assistir a filmes e séries via streaming direto no navegador.

## 🚀 Principais Tecnologias
- **Backend:** Node.js + Express
- **Frontend:** React + Lucide Icons
- **Banco de Dados:** SQLite (leve e portátil)
- **Processamento de Vídeo:** FFmpeg (Transcoding on-the-fly)
- **Streaming:** HLS (HTTP Live Streaming)
- **Metadados:** Integração com a API do TMDB

## 💎 Diferenciais Técnicos
- **Transcoding em Tempo Real:** Converte arquivos pesados (como `.mkv`) para formatos compatíveis com o navegador (`.mp4`/`hls`) instantaneamente.
- **Fast Seeking:** Sistema de salto temporal avançado que permite pular para qualquer minuto do vídeo em segundos, reiniciando o processamento do FFmpeg no ponto exato.
- **Design Glassmorphism:** Interface moderna com efeitos de desfoque, gradients dinâmicos e experiência de usuário fluida.
- **Gestão de Séries:** Agrupamento automático de episódios por temporada e série.
- **Segurança e Melhores Práticas:** Uso de variáveis de ambiente (`.env`) e `.gitignore` para proteção de dados sensíveis e privacidade.

## 🛠️ Como Instalar e Rodar

1. **Backend:**
   - Acesse a pasta `server/` e renomeie o arquivo `.env.example` para `.env`.
   - Adicione sua própria chave de API do TMDB e os caminhos das pastas onde guarda seus vídeos.
   - Instale as dependências com `npm install`.<img width="2480" height="942" alt="Tela inicial" src="https://github.com/user-attachments/assets/f2d94861-431a-447e-ac44-a2d30b756f56" />

   - Inicie o servidor com o comando `node index.js`.

2. **Frontend:**
   - Acesse a pasta `web/`, instale as dependências com `npm install`.
   - Inicie com `npm run dev`.

## 📸 Screenshots

Aqui você pode adicionar imagens que demonstram o seu projeto rodando! Salve suas fotos na pasta principal do projeto e troque o nome do arquivo abaixo:

![Tela Inicial - Exemplo](sua_foto_tela_inicial.png)
> *Tela principal mostrando o catálogo elegante de mídias.*

![Tela do Player - Exemplo](sua_foto_tela_player.png)
> *Player de vídeo rodando sem interrupções com HLS e FFmpeg.*

*(Para adicionar imagens é muito simples, basta arrastar as imagens para dentro do repositório no Github quando estiver editando o README, ou usar a tag Markdown como acima)*

---
**Nota Ética:** Este projeto foi desenvolvido apenas para fins de aprendizado e conveniência pessoal para consumo de mídia autohospedada.
