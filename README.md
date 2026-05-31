# OLITECH I.A V3.1 Corrigida

Correções:
- Pesquisa volta a ser padrão.
- Não imprime lixo/binário de anexos.
- Anexo passa pelo backend.
- Se Groq/OpenAI falhar, responde em modo local em vez de fetch failed.
- Leitura PDF/DOCX/XLSX preparada.

Admin:
olitech / 051309

Render:
AI_PROVIDER=groq
GROQ_API_KEY=sua_chave
GROQ_MODEL=llama-3.1-8b-instant
ENABLE_WEB_SEARCH=true
