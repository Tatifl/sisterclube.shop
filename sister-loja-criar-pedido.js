/**
 * SISTER CLUBE — Função Netlify
 * Recebe o carrinho, cria preferência no Mercado Pago
 * e registra o pedido no Bling
 *
 * Variáveis de ambiente necessárias (configurar no painel Netlify):
 * MP_ACCESS_TOKEN  = seu Access Token do Mercado Pago
 * BLING_API_KEY    = sua API Key do Bling
 * URL_LOJA         = https://sisterclub.netlify.app (sua URL)
 */

exports.handler = async function (event) {
  // Só aceita POST
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: JSON.stringify({ erro: 'JSON inválido' }) };
  }

  const { itens, cliente } = body;

  if (!itens || itens.length === 0) {
    return { statusCode: 400, body: JSON.stringify({ erro: 'Carrinho vazio' }) };
  }

  // ── 1. Criar preferência no Mercado Pago ─────────────────────────────────
  const mpPayload = {
    items: itens.map(item => ({
      id:          String(item.id),
      title:       item.name,
      quantity:    item.qty,
      unit_price:  item.price,
      currency_id: 'BRL',
      picture_url: 'https://sisterclub.netlify.app/images/' + item.id + '.jpg',
    })),
    payer: cliente ? {
      name:  cliente.nome  || '',
      email: cliente.email || '',
      phone: { number: cliente.telefone || '' },
    } : undefined,
    payment_methods: {
      excluded_payment_types: [],
      installments: 12,
    },
    back_urls: {
      success: (process.env.URL_LOJA || 'https://sisterclub.netlify.app') + '?pagamento=aprovado',
      failure: (process.env.URL_LOJA || 'https://sisterclub.netlify.app') + '?pagamento=recusado',
      pending: (process.env.URL_LOJA || 'https://sisterclub.netlify.app') + '?pagamento=pendente',
    },
    auto_return: 'approved',
    statement_descriptor: 'SISTER CLUBE',
    external_reference: 'SIS-' + Date.now(),
  };

  let checkoutUrl;
  let preferenceId;

  try {
    const mpResp = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': 'Bearer ' + process.env.MP_ACCESS_TOKEN,
      },
      body: JSON.stringify(mpPayload),
    });

    const mpData = await mpResp.json();

    if (!mpResp.ok) {
      console.error('MP error:', mpData);
      return {
        statusCode: 500,
        body: JSON.stringify({ erro: 'Erro ao criar preferência MP', detalhe: mpData }),
      };
    }

    checkoutUrl  = mpData.init_point;      // link de pagamento real
    preferenceId = mpData.id;
  } catch (err) {
    console.error('MP fetch error:', err);
    return { statusCode: 500, body: JSON.stringify({ erro: 'Erro de conexão com Mercado Pago' }) };
  }

  // ── 2. Registrar pedido no Bling ─────────────────────────────────────────
  if (process.env.BLING_API_KEY) {
    try {
      const subtotal = itens.reduce((s, i) => s + i.price * i.qty, 0);

      const blingPedido = {
        pedido: {
          data:           new Date().toISOString().split('T')[0].split('-').reverse().join('/'),
          numero_pedido_loja: 'SIS-' + Date.now(),
          nome_destinatario: cliente ? (cliente.nome || 'Cliente Sister') : 'Cliente Sister',
          cnpj_cpf:          cliente ? (cliente.cpf || '') : '',
          email_destinatario: cliente ? (cliente.email || '') : '',
          fone_destinatario:  cliente ? (cliente.telefone || '') : '',
          valor_desconto:    '0',
          valor_frete:       '0',
          total_produtos:    subtotal.toFixed(2),
          total_venda:       subtotal.toFixed(2),
          situacao:          'Em aberto',
          observacoes:       'Pedido via site Sister Clube | MP: ' + preferenceId,
          itens: itens.map(item => ({
            item: {
              codigo:      String(item.id),
              descricao:   item.name,
              qtde:        String(item.qty),
              vlr_unit:    item.price.toFixed(2),
            },
          })),
        },
      };

      const blingResp = await fetch(
        'https://bling.com.br/Api/v2/pedido/json/?apikey=' + process.env.BLING_API_KEY,
        {
          method:  'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body:    'xml=' + encodeURIComponent(
            '<?xml version="1.0" encoding="UTF-8"?>' +
            '<pedido>' +
            '<data>' + blingPedido.pedido.data + '</data>' +
            '<numero_pedido_loja>' + blingPedido.pedido.numero_pedido_loja + '</numero_pedido_loja>' +
            '<nome_destinatario>' + blingPedido.pedido.nome_destinatario + '</nome_destinatario>' +
            '<email_destinatario>' + blingPedido.pedido.email_destinatario + '</email_destinatario>' +
            '<fone_destinatario>' + blingPedido.pedido.fone_destinatario + '</fone_destinatario>' +
            '<total_produtos>' + blingPedido.pedido.total_produtos + '</total_produtos>' +
            '<total_venda>' + blingPedido.pedido.total_venda + '</total_venda>' +
            '<situacao>' + blingPedido.pedido.situacao + '</situacao>' +
            '<observacoes>' + blingPedido.pedido.observacoes + '</observacoes>' +
            '<itens>' +
            itens.map(item =>
              '<item>' +
              '<codigo>' + item.id + '</codigo>' +
              '<descricao>' + item.name + '</descricao>' +
              '<qtde>' + item.qty + '</qtde>' +
              '<vlr_unit>' + item.price.toFixed(2) + '</vlr_unit>' +
              '</item>'
            ).join('') +
            '</itens>' +
            '</pedido>'
          ),
        }
      );

      const blingData = await blingResp.json();
      console.log('Bling response:', JSON.stringify(blingData));
    } catch (err) {
      // Não bloqueia o checkout se o Bling falhar — só loga
      console.error('Bling error (não bloqueante):', err);
    }
  }

  // ── 3. Retornar URL de pagamento ─────────────────────────────────────────
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify({
      checkoutUrl,
      preferenceId,
    }),
  };
};
