# CaduSallers V5 - Bot de Vendas para Discord

Bot profissional de vendas para Discord com integração de pagamento Pix via Efí, carrinhos privados, sistema de tickets, gerenciamento de estoque e muito mais.

## 🚀 Funcionalidades

- **Painel Administrativo** (`/panel`)
- **Loja Pública** (`/loja` e `/setup`)
- **Gerenciamento de Produtos** (`/criar_produto`, `/manage_product`)
- **Gerenciamento de Estoque** (`/manage_stock`)
- **Carrinhos Privados** com integração Efí Pix
- **Sistema de Tickets** para atendimento
- **Pagamentos Pix** via Efí (cobrança imediata)
- **Webhook** para confirmação automática de pagamento
- **Contagem automática** após entrega (10→0)
- **Sistema de permissões** configurável
- **Logs de auditoria**
- **Métricas de vendas**
- **Cupons e descontos**
- **Backup e recuperação de estado**

## 📋 Pré-requisitos

- Node.js 16.0 ou superior
- Conta no [Discord Developer Portal](https://discord.com/developers/applications)
- Conta Efí com habilitação para Pix
- Certificado digital Efí (para produção)

## 🔧 Instalação

1. Clone o repositório
2. Instale as dependências:
   ```bash
   npm install
   ```
3. Copie o arquivo `.env.example` para `.env` e preencha as variáveis:
   ```bash
   cp .env.example .env
   ```
4. Configure suas credenciais no arquivo `.env`:
   ```
   DISCORD_TOKEN=seu_token_do_bot_aqui
   
   # Efí Configuration
   EFI_CLIENT_ID=seu_client_id_efi
   EFI_CLIENT_SECRET=seu_client_secret_efi
   EFI_CERTIFICATE_PATH=./certificados/certificate.pem
   EFI_KEY_PATH=./certificados/key.pem
   EFI_PIX_KEY=sua_chave_pix_efi
   EFI_ENVIRONMENT=homologacao  # ou producao
   
   # Webhook (opcional)
   WEBHOOK_PORT=3000
   ```
5. Configure o webhook no Portal Efí para apontar para `https://seuservidor.com/webhook/efi`

## ▶️ Como Executar

```bash
npm start
```

Para desenvolvimento:
```bash
node index.js
```

## 📦 Estrutura do Projeto

```
CaduSallers/
├── index.js              # Arquivo principal do bot
├── package.json          # Dependências e scripts
├── .env                  # Variáveis de ambiente (não versionar)
├── .env.example          # Exemplo de variáveis de ambiente
├── data/                 # Arquivo JSON de persistência
│   └── store.json        # Banco de dados
├── backups/              # Backups automáticos
└── README.md             # Este arquivo
```

## 💳 Integração Efí Pix

O bot utiliza a API oficial da Efí para cobrança Pix imediata:

1. Ao criar um carrinho, uma cobrança Pix é gerada automaticamente
2. O QR Code e código copia e cola são exibidos no canal do carrinho
3. O webhook recebe notificações da Efí para confirmação de pagamento
4. Após confirmação, o pedido fica aguardando entrega
5. Sistema de verificação manual disponível via botão

### Variáveis de Ambiente Efí

- `EFI_CLIENT_ID`: ID do cliente Efí
- `EFI_CLIENT_SECRET`: Segredo do cliente Efí
- `EFI_CERTIFICATE_PATH`: Caminho para o certificado Efí
- `EFI_KEY_PATH`: Caminho para a chave Efí
- `EFI_PIX_KEY`: Sua chave Pix para recebimento
- `EFI_ENVIRONMENT`: `homologacao` ou `producao`

## 🛡️ Segurança

- Todas as validações são feitas server-side
- Nenhum dado sensível é armazenado em logs
- Webhook valida autenticidade e integridade dos dados
- Sistema de idempotência evita processamento duplicado
- Permissões granulares para diferentes tipos de usuários

## 🔄 Fluxo de Venda

```
/setup → Painel da Loja → Cliente escolhe produto → Clique em Comprar
→ Canal privado criado com cobrança Efí → Cliente paga via Pix
→ Webhook confirma pagamento → Staff entrega produto
→ Contagem 10→0 automática → Canal excluído
```

## 📞 Suporte

Para issues e sugestões, por favor abra uma issue no repositório.

## 📝 Licença

ISC License

---

**Nota:** Nunca compartilhe seu token do Discord ou credenciais Efí em repositórios públicos.