# OLITECH I.A V5.1 Limpa

Correções:
- Versionamento unificado em V5.1.
- Sempre pede login ao abrir/recarregar.
- Remove auto-login.
- Imagem é carregada no backend e enviada para o chat como base64/dataURL.
- Não abre JSON/código em nova aba.
- Se Pollinations estiver em fila, mostra erro claro no chat.

Login:
olitech / 051309

Render:
AI_PROVIDER=gemini
ENABLE_WEB_SEARCH=true
GEMINI_API_KEY=sua_chave_google
GEMINI_MODEL=gemini-2.5-flash
GROQ_API_KEY=opcional
GROQ_MODEL=llama-3.1-8b-instant
AUTH_SECRET=olitech_ia_2026_senha_grande_segura

Remova:
GEMINI_IMAGE_MODEL
OPENAI_API_KEY
OPENAI_IMAGE_MODEL
