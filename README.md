# WhatsApp Compact Sidebar

Extensão pessoal para deixar a lista de conversas do WhatsApp Web estreita, com avatares e contadores de mensagens não lidas sobre as fotos. Mais espaço para a conversa aberta.

**Versão 0.1.0 — experimental.** Testada em uma simulação local com dados fictícios. A compatibilidade com a sessão atual do WhatsApp Web ainda precisa ser confirmada após instalar. Não é uma extensão oficial da Meta/WhatsApp.

## Instalar no Chrome (também funciona em navegadores Chromium, como Brave)

1. Baixe o repositório em **Code → Download ZIP** e extraia, ou use a pasta local do projeto.
2. No Chrome, digite `chrome://extensions` na barra de endereço. No Brave, use `brave://extensions`.
3. Ative **Modo do desenvolvedor**, no canto superior direito.
4. Clique em **Carregar sem compactação** (Load unpacked).
5. Selecione a pasta **extension** deste projeto — é a pasta que contém `manifest.json`.
6. Abra ou recarregue `https://web.whatsapp.com/`.
7. No menu de extensões (ícone de quebra-cabeça), fixe **WhatsApp Compact Sidebar** para acessar as opções.

Não é necessário instalar Node, executar comandos ou pagar para usar. Mantenha a pasta no mesmo lugar depois de instalar. Instale no navegador em que você usa o WhatsApp.

## Usar

- A lateral começa compacta, com 88 px. Clique numa foto para abrir a conversa.
- O contador mostra o indicador de não lidas já fornecido pelo WhatsApp (não é uma notificação do sistema operacional). Quando não há quantidade, aparece uma bolinha.
- Passe o mouse para ver o nome do contato e o indicador de não lidas.
- Clique em **»** para expandir e acessar pesquisa, filtros e demais controles originais. **«** recolhe novamente.
- Atalho: **Alt + Shift + C**, dentro da página.
- No ícone da extensão, altere a largura (80, 88 ou 104 px) ou desative a personalização.
- A barra nativa de navegação por ícones permanece disponível.
- Em janelas menores que 700 px e em listas não reconhecidas/vazias, o layout original é preservado.

## Privacidade

O código roda somente em `https://web.whatsapp.com/*`. A única permissão adicional é `storage`, para salvar ativação, modo e largura no navegador. Não há servidor, IA, telemetria, cookies lidos pela extensão ou envio de conversas. Nomes, fotos e indicadores já presentes na lista são usados apenas para a apresentação local. Não guardamos contatos nem mensagens. Fotos usam as mesmas URLs já presentes na página.

## Limitações e recuperação

O WhatsApp não oferece um contrato público estável para alterar seu layout. Mudanças no HTML podem exigir manutenção em `SELECTORS` e `findColumn`, no arquivo `extension/content.js`. Os indicadores de não lidas reconhecem português, inglês e espanhol, além de alguns identificadores estruturais.

Não modificamos a altura, a ordem ou os eventos das linhas nativas, para preservar a rolagem virtualizada e os cliques. O layout é recolhido somente quando a lista e os avatares são reconhecidos. Isso reduz, mas não elimina, incompatibilidades com futuras versões.

Se algo ficar estranho: expanda com **Alt + Shift + C** ou desative a extensão no painel e recarregue a página. Para remover, vá a `chrome://extensions`, clique em **Remover** e recarregue o WhatsApp. Após atualizar os arquivos, clique em **Recarregar** no cartão da extensão e recarregue também o WhatsApp.

## Desenvolvimento

Extensão Manifest V3, JavaScript e CSS sem bibliotecas em tempo de execução.

```sh
npm install
npx playwright install chromium
npm run check
npm test
```

Os testes usam Chromium em modo headless, sem acessar uma conta do WhatsApp. Verificam dimensões, cliques nativos, contadores dinâmicos, reciclagem de linhas, alternância, largura, telas estreitas, desativação e opções. Capturas ficam em `test-results/` e não são versionadas.

Estrutura:

- `extension/`: arquivos prontos para instalar, sem compilação.
- `tests/fixture.html`: simulação com contatos e mensagens fictícias.
- `tests/extension.test.mjs`: testes de comportamento.
- `scripts/package.mjs`: copia os arquivos para `dist/extension` com `npm run package`.

Antes de considerar estável, validar no WhatsApp real: login, fotos/grupos sem foto, recebimento de mensagens, leitura dos contadores, conversas arquivadas, filtros, pesquisa, troca de conversa, rolagem longa e temas claro/escuro.
