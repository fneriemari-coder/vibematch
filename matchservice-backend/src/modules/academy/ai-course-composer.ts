import type { GeneratedCourseScope } from './ai-factory.service';

/**
 * Deterministic local course composer — the offline half of
 * `prisma/seed-ai-courses.ts`.
 *
 * `OPENAI_API_KEY` is routinely absent or stale in staging and on a fresh
 * production deploy, and the demo cannot depend on it: a catalogue that says
 * "conteúdo em breve" is worse than no catalogue at all. So every topic below
 * ships with a real, hand-written Portuguese course — commercial description,
 * three module titles, and three full lesson scripts of several hundred words
 * each, written in the same instructor voice the model is prompted for in
 * `ai-factory.service.ts`.
 *
 * The `title` field doubles as the idempotency key: the seed script skips a
 * topic whose title already exists, so re-running it never piles up
 * duplicates.
 */
export interface ComposedTopic {
  /** Stable idempotency key — also the course title on the offline path. */
  title: string;
  /** Passed to the model as `topicHint` when OpenAI is reachable. */
  topicHint: string;
  scope: GeneratedCourseScope;
}

export const AI_COURSE_TOPICS: ComposedTopic[] = [
  {
    title: 'Fluxo de Caixa Previsível: o Painel de 13 Semanas',
    topicHint:
      'Previsibilidade de caixa para empresas de médio porte: projeção rolante de 13 semanas, ' +
      'antecipação de aperto e decisão de prazo com fornecedor e cliente.',
    scope: {
      courseTitle: 'Fluxo de Caixa Previsível: o Painel de 13 Semanas',
      commercialDescription:
        'A maior parte das empresas que quebra é lucrativa no papel. Este curso monta, do zero, a projeção rolante ' +
        'de 13 semanas que mostra o aperto seis semanas antes de ele acontecer — e ensina as três alavancas de prazo ' +
        'que resolvem o problema sem recorrer a capital de giro caro.',
      skillsTaught: ['CONTROLLER', 'FINANCIAL_AUDIT', 'PAYMENTS'],
      modules: [
        {
          title: 'Por que empresa lucrativa fica sem dinheiro',
          voiceScript:
            'Vou começar por uma frase que parece contradição e não é: a maior parte das empresas que fecha as portas ' +
            'estava dando lucro no mês em que fechou. Lucro e caixa são duas medidas diferentes, e confundir as duas é ' +
            'o erro mais caro que um dono de empresa comete.\n\n' +
            'Lucro é uma medida de competência. Ele responde: eu vendo por mais do que me custa produzir e operar? ' +
            'Caixa é uma medida de tempo. Ele responde: o dinheiro entra antes de eu precisar pagar? São perguntas ' +
            'independentes. Você pode ter uma margem excelente e mesmo assim não ter dinheiro na conta na sexta-feira, ' +
            'porque vendeu para receber em sessenta dias e comprou para pagar em vinte e oito.\n\n' +
            'Esse descasamento tem um nome: ciclo financeiro. Some os dias que o seu estoque fica parado, some os dias ' +
            'que o seu cliente demora para pagar e subtraia os dias que o seu fornecedor te dá. O resultado é quantos ' +
            'dias de operação você precisa financiar do próprio bolso. Numa empresa de serviço, o estoque é a folha: ' +
            'você paga o time no quinto dia útil independentemente de o cliente ter pago.\n\n' +
            'Aqui está o padrão que eu vejo repetidamente. A empresa cresce trinta por cento. Cada venda nova é ' +
            'lucrativa. E o caixa piora, porque cada venda nova exige financiar mais dias de operação antes de o ' +
            'dinheiro voltar. Crescimento consome caixa. Quem não sabe disso interpreta o aperto como problema de ' +
            'vendas e vende ainda mais, o que acelera o afogamento.\n\n' +
            'Existem três sintomas que sempre aparecem antes do problema virar crise. Primeiro: você começa a olhar o ' +
            'saldo bancário todos os dias, várias vezes por dia. Segundo: você passa a escolher quais boletos pagar em ' +
            'que ordem. Terceiro: alguém no time sugere antecipar recebíveis, e a taxa de repente parece razoável. ' +
            'Quando o terceiro sintoma aparece, você já está pagando caro por um problema que era de planejamento.\n\n' +
            'O que resolve não é mais uma linha de crédito. É enxergar o descasamento com antecedência suficiente para ' +
            'agir com prazo, e não com juros. É exatamente isso que a projeção de treze semanas faz, e é o que vamos ' +
            'montar no próximo módulo. Antes de seguir, faça uma coisa: pegue os últimos três meses e calcule o seu ' +
            'ciclo financeiro em dias. Esse número é o tamanho real do buraco que você financia todo mês.',
        },
        {
          title: 'Montando a projeção rolante de 13 semanas',
          voiceScript:
            'Agora vamos construir a ferramenta. Treze semanas, não doze e não seis meses, e há uma razão para o ' +
            'número. Treze semanas é um trimestre: longo o bastante para você enxergar o aperto com antecedência de ' +
            'agir, e curto o bastante para que a projeção ainda tenha alguma relação com a realidade. Projeção de doze ' +
            'meses em nível semanal é ficção, e ficção ninguém usa para decidir.\n\n' +
            'A estrutura é simples. Uma coluna por semana. Na primeira linha, o saldo inicial de caixa. Depois, os ' +
            'recebimentos, e aqui vem a primeira regra que muda tudo: você lança pela data provável de recebimento, ' +
            'não pela data de vencimento. Se o seu maior cliente paga historicamente com nove dias de atraso, lance ' +
            'com nove dias de atraso. Uma projeção que assume que todo mundo paga em dia não é otimista, é inútil.\n\n' +
            'Depois vêm os pagamentos, separados em três blocos. Bloco um, o inegociável: folha, encargos, impostos, ' +
            'aluguel. Bloco dois, o operacional: fornecedores, serviços, insumos. Bloco três, o discricionário: ' +
            'investimento, marketing, melhorias. Essa separação não é estética. É ela que, numa semana apertada, mostra ' +
            'em segundos o que dá para empurrar sem quebrar nada.\n\n' +
            'A última linha é o saldo final da semana, que vira o saldo inicial da semana seguinte. É isso. Não precisa ' +
            'de sistema, uma planilha resolve. O que precisa é de disciplina de atualização: toda segunda-feira você ' +
            'derruba a semana que passou, acrescenta uma semana nova no fim e ajusta as previsões com o que aprendeu. ' +
            'Por isso chamamos de rolante — a janela anda, o horizonte é sempre treze semanas.\n\n' +
            'Duas regras que evitam noventa por cento dos erros de quem monta isso pela primeira vez. Primeira: não ' +
            'misture regime de competência com regime de caixa na mesma planilha. Esta ferramenta é caixa puro, dinheiro ' +
            'entrando e saindo da conta, e nada mais. Segunda: registre a previsão anterior ao lado do realizado. No fim ' +
            'do primeiro mês você vai saber exatamente onde erra — quase sempre é otimismo no recebimento — e a partir ' +
            'do segundo mês a sua projeção passa a acertar.\n\n' +
            'Reserve noventa minutos para montar a primeira versão e trinta minutos por semana para manter. É o melhor ' +
            'retorno por hora que existe em gestão financeira de empresa pequena e média.',
        },
        {
          title: 'As três alavancas de prazo antes de buscar crédito',
          voiceScript:
            'A projeção mostrou uma semana negativa daqui a cinco semanas. Você tem cinco semanas para agir, e é aí que ' +
            'esse trabalho todo se paga. Quem descobre o buraco com cinco semanas resolve com negociação. Quem descobre ' +
            'na véspera resolve com juros.\n\n' +
            'Alavanca um: prazo de recebimento. Não estou falando de cobrar mais rápido no grito. Estou falando de ' +
            'desenho comercial. Ofereça de dois a três por cento de desconto para pagamento antecipado e compare essa ' +
            'taxa com o custo real do seu capital de giro — quase sempre o desconto é mais barato. Para contratos ' +
            'recorrentes, mude o vencimento para antes da folha, não depois. E adote sinal de trinta a cinquenta por ' +
            'cento em projetos, algo que o mercado aceita muito melhor do que a maioria imagina.\n\n' +
            'Alavanca dois: prazo de pagamento. Fornecedor que você paga há três anos sem atraso tem valor, e esse valor ' +
            'é negociável. A conversa não é "estou apertado"; é "quero aumentar volume com você e preciso que o prazo ' +
            'acompanhe". Ganhar quinze dias com os três maiores fornecedores costuma valer mais do que qualquer linha de ' +
            'crédito, e custa uma reunião.\n\n' +
            'Alavanca três: o timing das saídas discricionárias. Aquele bloco três que separamos no módulo anterior ' +
            'existe exatamente para este momento. Adiar em três semanas a compra de equipamento, a contratação prevista ' +
            'ou a campanha planejada não destrói nada e resolve a maior parte dos apertos pontuais. É uma decisão ' +
            'consciente, não um corte no desespero.\n\n' +
            'Só depois de exaurir as três alavancas você discute crédito. E aí a conversa com o banco muda de natureza: ' +
            'você chega com projeção de treze semanas, mostra exatamente quando precisa do dinheiro, quanto precisa e ' +
            'com o quê vai devolver. Isso é a diferença entre negociar taxa e aceitar a taxa que te oferecerem.\n\n' +
            'Fecho com o hábito que sustenta tudo: trinta minutos toda segunda-feira, sempre o mesmo horário, uma pessoa ' +
            'responsável nomeada. Quem faz isso por um trimestre nunca mais volta a administrar empresa olhando o saldo ' +
            'do banco. Você passa a decidir com semanas de antecedência, e essa antecedência vale dinheiro real.',
        },
      ],
    },
  },
  {
    title: 'Atendimento que Não Perde Lead: Automação de WhatsApp com IA',
    topicHint:
      'Automação de atendimento comercial no WhatsApp com IA: qualificação de lead, integração com CRM ' +
      'e handoff para humano sem perder contexto.',
    scope: {
      courseTitle: 'Atendimento que Não Perde Lead: Automação de WhatsApp com IA',
      commercialDescription:
        'Metade dos orçamentos perdidos morre no tempo de resposta, não no preço. Este curso monta um atendimento ' +
        'automatizado que responde em segundos, qualifica com quatro perguntas e passa para um humano com o contexto ' +
        'inteiro — sem virar aquele robô que faz o cliente digitar "atendente" três vezes.',
      skillsTaught: ['AI_AUTOMATION', 'MAKE', 'SaaS'],
      modules: [
        {
          title: 'O custo real do tempo de resposta',
          voiceScript:
            'Antes de falar de ferramenta, quero que você olhe um número da sua própria operação: quanto tempo, em ' +
            'média, leva entre uma pessoa mandar a primeira mensagem e alguém do seu time responder. Não a média que ' +
            'você imagina, a média real, contando fim de semana, horário de almoço e a terça-feira em que todo mundo ' +
            'estava em reunião.\n\n' +
            'Esse número é o seu maior vazamento comercial, e quase ninguém mede. O comportamento de quem pede orçamento ' +
            'é conhecido: a pessoa manda mensagem para três ou quatro fornecedores praticamente ao mesmo tempo e trata ' +
            'com atenção quem responder primeiro. Não é que ela ache o primeiro melhor. É que ela já investiu contexto ' +
            'na conversa que começou, e recomeçar dá trabalho.\n\n' +
            'A consequência prática é dura: você não perde para quem cobra menos, perde para quem respondeu antes. E o ' +
            'pior é que esse cliente nunca aparece no seu relatório de vendas perdidas, porque ele nunca chegou a virar ' +
            'uma oportunidade. Ele é uma mensagem não respondida numa caixa de entrada.\n\n' +
            'Agora, a solução não é o robô que todo mundo odeia. Você conhece o padrão: menu numerado, resposta que não ' +
            'tem nada a ver com a pergunta, e a pessoa digitando "atendente, atendente, atendente" até desistir. Esse ' +
            'tipo de automação piora o problema, porque adiciona atrito ao mesmo tempo em que não resolve.\n\n' +
            'O que funciona tem três características. Primeira: responde em segundos, com uma mensagem que reconhece o ' +
            'que a pessoa efetivamente escreveu, não uma saudação genérica. Segunda: coleta no máximo quatro informações ' +
            'antes de passar adiante — o que a pessoa precisa, para quando, onde e qual a ordem de grandeza do ' +
            'orçamento. Terceira: entrega para o humano com o histórico inteiro, para que ninguém peça de novo algo que ' +
            'a pessoa já respondeu. Repetir pergunta é o que mais irrita.\n\n' +
            'Repare que nenhuma dessas três características é sobre inteligência artificial. A IA entra para entender ' +
            'texto livre e reduzir o atrito da coleta. Mas o desenho do fluxo é trabalho de operação, e é ele que ' +
            'determina se vai funcionar. Nos próximos dois módulos, montamos os dois.',
        },
        {
          title: 'Desenhando o fluxo de qualificação em quatro perguntas',
          voiceScript:
            'Vamos ao desenho. A regra que organiza tudo é esta: o objetivo da automação não é vender, é qualificar e ' +
            'agendar. Toda vez que alguém tenta fazer o robô fechar negócio, a coisa desanda, porque fechar negócio ' +
            'depende de responder objeção específica, e isso ainda é trabalho humano.\n\n' +
            'A primeira mensagem precisa fazer duas coisas ao mesmo tempo: confirmar que a mensagem chegou e devolver ' +
            'algo de valor imediato. Compare "Olá! Em que posso ajudar?" com "Oi, Marina! Recebi o seu pedido de ' +
            'orçamento para troca de piso. Faço três perguntas rápidas e já te passo faixa de preço e prazo." A segunda ' +
            'informa, dá sensação de progresso e justifica as perguntas que vêm em seguida. A primeira empurra o ' +
            'trabalho de volta para o cliente.\n\n' +
            'Depois vêm as quatro perguntas, uma por mensagem, nunca todas de uma vez. Escopo: o que exatamente a pessoa ' +
            'precisa. Prazo: para quando. Localização ou contexto: onde é, ou qual o porte da empresa. E a quarta, a que ' +
            'todo mundo tem medo de fazer: ordem de grandeza de orçamento. Perguntar isso não afasta cliente bom, afasta ' +
            'cliente incompatível — e afastar cedo é economia, não perda.\n\n' +
            'Cada resposta precisa ter tratamento para o caso ambíguo. Se a pessoa responde "não sei ainda" para prazo, ' +
            'a automação oferece duas opções concretas em vez de insistir. Se a resposta não tem relação com a pergunta, ' +
            'ela reconhece o que foi dito, responde aquilo e volta ao trilho. É aqui que a IA ganha do menu numerado: ' +
            'ela lida com texto livre, e gente escreve como gente.\n\n' +
            'Estabeleça três regras de escape, e trate isso como inegociável. Uma: qualquer pedido explícito de falar ' +
            'com humano transfere na hora, sem tentar mais uma pergunta. Duas: duas respostas seguidas que a automação ' +
            'não entendeu transferem automaticamente. Três: palavras de urgência ou de reclamação — vazamento, ' +
            'cancelamento, processo, urgente — transferem imediatamente e marcam a conversa como prioritária.\n\n' +
            'Por fim, defina o que conta como lead qualificado, em critério escrito. Escopo compatível, prazo dentro do ' +
            'que você atende, orçamento na faixa. Só o que passa nos três chega ao comercial. O resto recebe uma ' +
            'resposta honesta e educada, e isso protege o tempo do seu time melhor do que qualquer treinamento.',
        },
        {
          title: 'Integração com o CRM e o handoff para o humano',
          voiceScript:
            'Terceiro módulo: fazer a conversa virar registro e o registro virar acompanhamento. Sem isso, você ' +
            'automatizou a entrada e continuou perdendo lead na saída — só que agora perde mais rápido.\n\n' +
            'A regra estruturante é: toda conversa vira um registro no CRM, sem exceção. Não só as que qualificaram. ' +
            'As desqualificadas são dado de mercado: se um terço das pessoas pede algo que você não faz, isso é ou uma ' +
            'oportunidade de produto ou um problema de posicionamento no seu anúncio. Esse relatório só existe se você ' +
            'guardar tudo.\n\n' +
            'O registro precisa carregar cinco campos, no mínimo: origem da conversa, as quatro respostas de ' +
            'qualificação, o status atribuído pela automação, a transcrição completa e o horário da primeira mensagem. ' +
            'Esse último campo é o que permite medir o tempo de resposta de verdade daí em diante, e é o indicador que ' +
            'vai justificar todo o projeto para quem aprovou o gasto.\n\n' +
            'O handoff é a parte que mais dá errado na prática. O padrão que funciona tem três elementos. Primeiro, a ' +
            'automação avisa a pessoa que está transferindo e dá uma expectativa concreta de tempo: "vou te passar para ' +
            'o Rodrigo, ele responde em até quinze minutos no horário comercial". Segundo, o vendedor recebe um resumo ' +
            'de três linhas no topo, não a transcrição inteira — ninguém lê quarenta mensagens antes de responder. ' +
            'Terceiro, a automação para de escrever completamente naquela conversa. Robô que continua opinando depois do ' +
            'handoff é constrangedor e destrói a confiança que você acabou de construir.\n\n' +
            'Sobre a arquitetura: use a API oficial do WhatsApp Business, um orquestrador como o Make ou o n8n para os ' +
            'fluxos, e o modelo de linguagem apenas nos pontos em que interpretar texto livre é necessário. Não coloque ' +
            'a IA no meio de operações determinísticas, como gravar no CRM ou disparar notificação. Ela é imprevisível ' +
            'por natureza, e você não quer imprevisibilidade nas partes que precisam simplesmente funcionar.\n\n' +
            'Meça três indicadores por semana: tempo médio até a primeira resposta, percentual de conversas que a ' +
            'automação resolveu sem humano, e taxa de conversão dos leads qualificados comparada com a de antes. Se o ' +
            'primeiro cair de horas para segundos e o terceiro não piorar, o projeto se pagou. Se o terceiro piorar, ' +
            'quase sempre o problema está na quarta pergunta, e não na tecnologia.',
        },
      ],
    },
  },
  {
    title: 'Cobrança Recorrente sem Vazamento: Webhooks, Retentativa e Conciliação',
    topicHint:
      'Receita recorrente confiável: validação de webhook de pagamento, idempotência na retentativa e ' +
      'conciliação entre o gateway e o financeiro.',
    scope: {
      courseTitle: 'Cobrança Recorrente sem Vazamento: Webhooks, Retentativa e Conciliação',
      commercialDescription:
        'Receita recorrente vaza em silêncio: webhook que não chegou, cartão recusado que ninguém retentou, baixa ' +
        'que não bateu com o extrato. Este curso fecha as três portas com o padrão exato de validação, idempotência e ' +
        'conciliação que uma operação de assinatura precisa ter antes de escalar.',
      skillsTaught: ['STRIPE_WEBHOOK', 'PAYMENTS', 'BACKEND'],
      modules: [
        {
          title: 'Por que o webhook falha em silêncio',
          voiceScript:
            'Vou descrever um incidente que eu já vi em quatro empresas diferentes, com o mesmo desfecho. A operação ' +
            'roda bem por meses. Um dia, o suporte recebe a mensagem de um cliente dizendo que pagou e continua sem ' +
            'acesso. Alguém confere, vê o pagamento no painel do gateway, libera na mão e considera resolvido. Duas ' +
            'semanas depois, outro cliente. Aí alguém pergunta quantos casos assim aconteceram sem ninguém reclamar, e a ' +
            'resposta é que não dá para saber, porque não existe registro.\n\n' +
            'A causa quase sempre é a mesma: o sistema trata o webhook como se ele fosse uma chamada confiável, ' +
            'ordenada e única. Ele não é nenhuma das três coisas.\n\n' +
            'Primeiro, webhook não é confiável. O gateway tenta entregar; se a sua aplicação estava reiniciando, se o ' +
            'deploy derrubou a instância por oito segundos ou se a resposta demorou demais, a entrega falha. O gateway ' +
            'retenta, mas com espaçamento crescente, e depois de algumas horas desiste. Se você não tem um processo que ' +
            'busca ativamente os eventos que faltaram, aquele pagamento simplesmente não existe no seu sistema.\n\n' +
            'Segundo, webhook não é ordenado. É perfeitamente possível receber o evento de assinatura atualizada antes ' +
            'do evento de pagamento concluído. Se o seu código assume a ordem, ele vai processar um estado impossível — ' +
            'e a maior parte dos bugs de cobrança nasce exatamente aí.\n\n' +
            'Terceiro, webhook não é único. O mesmo evento pode chegar duas vezes, e chega mais do que você imagina. ' +
            'Sem idempotência, o mesmo pagamento credita dois meses de acesso, ou o mesmo estorno debita duas vezes. ' +
            'Essa é a falha que aparece no financeiro e ninguém consegue explicar.\n\n' +
            'A quarta armadilha é de segurança e merece parágrafo próprio: aceitar webhook sem validar assinatura ' +
            'criptográfica. O endpoint é público. Sem validação, qualquer pessoa que descubra a URL consegue postar um ' +
            'evento de pagamento aprovado e ganhar acesso pago de graça. Não é hipótese, é um alvo comum de varredura.\n\n' +
            'Nos próximos módulos, resolvemos as quatro: validação de assinatura, idempotência de verdade, tolerância a ' +
            'desordem e um processo de reconciliação que encontra o que se perdeu. Antes de seguir, abra o log do seu ' +
            'endpoint de webhook e responda: você consegue listar os eventos que falharam nos últimos trinta dias? Se a ' +
            'resposta for não, você tem um vazamento e ainda não sabe o tamanho dele.',
        },
        {
          title: 'Assinatura, idempotência e retentativa segura',
          voiceScript:
            'Agora o padrão de implementação. São quatro camadas, e a ordem importa.\n\n' +
            'Camada um, validação de assinatura. O gateway assina o corpo da requisição com um segredo compartilhado. ' +
            'Você recalcula a assinatura sobre o corpo bruto e compara. A palavra crítica aqui é bruto: se algum ' +
            'middleware de JSON já parseou e reserializou o corpo antes de você calcular, um espaço em branco de ' +
            'diferença invalida a assinatura, e você passa uma tarde inteira achando que o segredo está errado. ' +
            'Registre a rota do webhook antes do parser de JSON. Valide também o timestamp e rejeite eventos com mais de ' +
            'cinco minutos, o que elimina ataque de repetição.\n\n' +
            'Camada dois, persistência antes de processar. Grave o evento cru numa tabela — identificador do evento, ' +
            'tipo, corpo completo, horário de recebimento, status pendente — e responda 200 imediatamente. Processar ' +
            'antes de responder é o erro clássico: se o seu processamento demora doze segundos, o gateway considera ' +
            'timeout, retenta, e você processa duas vezes o mesmo evento enquanto acha que está tudo certo.\n\n' +
            'Camada três, idempotência de verdade. O identificador do evento é único por chave, então grave-o com um ' +
            'índice único e trate a violação como sucesso silencioso: já vi esse evento, não faço de novo. E vá além: ' +
            'a operação de negócio em si também precisa ser idempotente. Em vez de somar trinta dias ao acesso, defina ' +
            'a data de expiração calculada a partir do período de cobrança. Assim, mesmo que algo escape, o resultado ' +
            'não duplica.\n\n' +
            'Camada quatro, tolerância a desordem. Antes de aplicar um evento, compare o carimbo de tempo dele com o do ' +
            'último evento já aplicado àquela assinatura. Se o novo for mais antigo, ignore. Isso resolve a maior parte ' +
            'das inconsistências de estado sem nenhuma lógica complicada.\n\n' +
            'Sobre retentativa de cartão recusado: não retente imediatamente. A recusa costuma ser por saldo, e o padrão ' +
            'que funciona é retentar em três, cinco e sete dias, sempre em horário comercial, com aviso ao cliente entre ' +
            'as tentativas. Depois da terceira, suspenda o acesso mas não apague nada por trinta dias — boa parte desses ' +
            'clientes volta, e apagar dado é a forma mais eficiente de garantir que não voltem.\n\n' +
            'Por último, um alerta simples que vale mais do que todo o resto: se nenhum webhook chegar por mais de sessenta ' +
            'minutos num horário de movimento normal, alguém precisa ser notificado. Silêncio é o sintoma mais perigoso, ' +
            'porque parece exatamente com "está tudo bem".',
        },
        {
          title: 'Conciliação: fechando o mês com o extrato do gateway',
          voiceScript:
            'Módulo final, e é o que separa quem tem cobrança funcionando de quem apenas acredita que tem. Conciliação é ' +
            'comparar três fontes que precisam contar a mesma história: o que o seu sistema registrou, o que o gateway ' +
            'diz que cobrou, e o que efetivamente caiu na conta bancária.\n\n' +
            'Elas nunca batem de primeira, e isso é normal. Existem diferenças legítimas: repasse em D mais um ou D mais ' +
            'trinta, taxa do gateway descontada antes do repasse, estorno que aparece na semana seguinte, pagamento em ' +
            'moeda estrangeira com câmbio do dia da liquidação. O objetivo não é chegar a zero de diferença. É que toda ' +
            'diferença tenha explicação nomeada.\n\n' +
            'O processo prático é um relatório semanal com quatro listas. Lista um: cobranças no gateway sem registro ' +
            'correspondente no seu sistema — são os webhooks perdidos, e cada linha aqui é um cliente que pagou e pode ' +
            'não ter recebido. Lista dois: registros no seu sistema sem cobrança correspondente no gateway — geralmente ' +
            'liberação manual que ninguém documentou. Lista três: valores que divergem entre as duas fontes. Lista ' +
            'quatro: repasses bancários que não fecham com a soma esperada do período.\n\n' +
            'A lista um deve ser zero. Se não for, você precisa de um processo de recuperação: uma rotina diária que ' +
            'consulta a API do gateway pelos eventos das últimas quarenta e oito horas e reprocessa o que não tem ' +
            'registro local. Como todo o seu processamento é idempotente — construímos isso no módulo anterior — ' +
            'reprocessar é seguro por definição. Essa rotina é a rede de segurança que torna o webhook uma otimização ' +
            'em vez de um ponto único de falha.\n\n' +
            'Três indicadores para acompanhar toda semana. Percentual de eventos processados com sucesso na primeira ' +
            'tentativa: abaixo de noventa e nove por cento, investigue. Número de eventos recuperados pela rotina ' +
            'diária: se estiver subindo, algo na sua infraestrutura degradou. E diferença de conciliação não explicada: ' +
            'a meta é zero, e qualquer valor diferente disso é dívida que cresce.\n\n' +
            'Quem monta essas três coisas — validação, idempotência e conciliação — para de descobrir problema de ' +
            'cobrança pelo cliente reclamando. Passa a descobrir pelo relatório, na segunda-feira de manhã, quando ' +
            'ainda dá para consertar sem ninguém se irritar.',
        },
      ],
    },
  },
  {
    title: 'Presença Local que Gera Orçamento: SEO de Bairro para Prestadores',
    topicHint:
      'Aquisição local para prestadores de serviço: perfil no Google, avaliações como ativo comercial e ' +
      'conteúdo de bairro que gera pedido de orçamento.',
    scope: {
      courseTitle: 'Presença Local que Gera Orçamento: SEO de Bairro para Prestadores',
      commercialDescription:
        'Quem contrata serviço perto de casa decide em três minutos e olha três coisas: distância, nota e as ' +
        'fotos. Este curso arruma essas três em quatro semanas, monta a rotina de avaliações que sustenta o ' +
        'resultado e mede sucesso em pedidos de orçamento, não em posição de ranking.',
      skillsTaught: ['LOCAL_SEO', 'LOCAL_SERVICE', 'B2B_NETWORKING'],
      modules: [
        {
          title: 'Como as pessoas escolhem um prestador perto de casa',
          voiceScript:
            'Vamos começar pelo comportamento real de quem contrata, porque é dele que sai toda a estratégia. Alguém ' +
            'descobre um vazamento às oito da noite. Pega o telefone e busca por encanador mais o nome do bairro. O que ' +
            'aparece é um bloco com três empresas no mapa, e a decisão acontece ali, em menos de três minutos.\n\n' +
            'Nesses três minutos, a pessoa olha três coisas, sempre nesta ordem. Distância, porque ninguém quer esperar ' +
            'uma hora de deslocamento. Nota e quantidade de avaliações, porque é o único sinal de confiança disponível ' +
            'para quem não conhece você. E fotos, para saber se parece um profissional de verdade ou um cadastro ' +
            'abandonado.\n\n' +
            'Repare no que não está nessa lista: o seu site. Para serviço local urgente, o site quase não participa da ' +
            'decisão. Quem investe cinco mil reais num site bonito e deixa o perfil do Google com três fotos tortas e ' +
            'nenhuma avaliação está gastando dinheiro no lugar errado. O perfil é a vitrine; o site, no máximo, confirma.\n\n' +
            'Três problemas derrubam mais negócios do que qualquer concorrente, e todos são de arrumação. Primeiro: ' +
            'endereço, nome e telefone diferentes entre o Google, o Instagram e os diretórios antigos. Isso confunde o ' +
            'algoritmo e confunde o cliente, e é o motivo número um de perda de visibilidade por bairro. Segundo: ' +
            'categoria errada ou genérica no perfil, o que faz você simplesmente não aparecer nas buscas que importam. ' +
            'Terceiro: perfil sem movimento há meses — sem foto nova, sem resposta a avaliação, sem publicação.\n\n' +
            'Existe um quarto problema, mais grave e menos conhecido: perfis duplicados. Alguém criou um cadastro anos ' +
            'atrás, você criou outro depois, e agora as suas avaliações estão divididas entre dois registros que ' +
            'competem um com o outro. Resolver isso é chato e burocrático, mas é a maior alavanca isolada que existe ' +
            'quando o caso aparece.\n\n' +
            'A boa notícia é que quase toda a concorrência local também não faz nada disso. Numa cidade média, arrumar o ' +
            'básico com consistência costuma colocar você entre os três primeiros em quatro a seis semanas. É o próximo ' +
            'módulo, item por item.',
        },
        {
          title: 'Arrumando o perfil e transformando avaliação em ativo',
          voiceScript:
            'Mãos à obra. Começamos pela consistência de dados, que é chata e é a mais importante. Escreva num documento ' +
            'a forma canônica do seu nome comercial, endereço e telefone. Exatamente essa forma, caractere por ' +
            'caractere, precisa aparecer no Google, no Instagram, no site, no rodapé dos e-mails e em qualquer diretório ' +
            'onde você esteja listado. "Rua" e "R." são coisas diferentes para o algoritmo. Faça uma busca pelo seu ' +
            'próprio telefone e liste todos os lugares onde ele aparece; costuma haver surpresa.\n\n' +
            'Categoria: escolha a mais específica que descreva o que você faz, não a mais abrangente. Instalador de ' +
            'pisos ganha de empresa de reformas se instalar piso é o que você faz. Adicione categorias secundárias ' +
            'apenas para serviços que você realmente presta com frequência.\n\n' +
            'Fotos: no mínimo vinte, e nenhuma delas de banco de imagens. O que funciona é o serviço real, antes e ' +
            'depois no mesmo enquadramento, a equipe uniformizada, o veículo e o material sendo aplicado. Fotografe de ' +
            'dia, com o celular estabilizado. Adicione três ou quatro fotos novas por mês; movimento no perfil é sinal ' +
            'de negócio ativo.\n\n' +
            'Agora avaliações, que é onde está o dinheiro. Duas coisas importam: a quantidade e a constância. Vinte ' +
            'avaliações espalhadas pelos últimos doze meses valem mais do que sessenta concentradas em duas semanas de ' +
            'dois anos atrás — e a segunda situação ainda parece manipulação.\n\n' +
            'O pedido tem hora certa: no momento em que o cliente demonstra satisfação, geralmente logo depois da ' +
            'entrega, ainda no local. Mensagem depois de três dias tem taxa muito menor. Peça pessoalmente, mande o ' +
            'link curto na hora e nunca ofereça desconto em troca — além de ser proibido pela plataforma, gera texto ' +
            'genérico que não convence ninguém.\n\n' +
            'Responda todas, sem exceção, em até dois dias. Nas positivas, responda mencionando o serviço específico: ' +
            'isso adiciona os termos que as pessoas buscam e mostra que existe gente atrás do perfil. Nas negativas, ' +
            'o padrão que funciona tem três partes: reconheça o ocorrido sem discutir fato, diga o que foi feito para ' +
            'corrigir e ofereça continuar a conversa fora dali. Quem lê uma avaliação negativa bem respondida costuma ' +
            'confiar mais, não menos. A resposta é para os próximos duzentos leitores, não para quem reclamou.',
        },
        {
          title: 'Conteúdo de bairro e a métrica que realmente importa',
          voiceScript:
            'Último módulo, e vou começar desmontando a métrica errada. Posição no ranking não é o seu indicador. ' +
            'Resultado de busca local varia por dispositivo, por histórico e por quantos metros a pessoa está de você. ' +
            'Duas pessoas na mesma rua veem listas diferentes. Perseguir posição é perseguir um número que não existe de ' +
            'forma estável.\n\n' +
            'O seu indicador é quantos pedidos de orçamento entraram no mês e de onde vieram. Isso se mede: use um ' +
            'número de telefone específico para o perfil do Google, ou pelo menos pergunte a origem em toda primeira ' +
            'conversa e anote. Trinta dias disso e você sabe exatamente o que está funcionando.\n\n' +
            'Sobre conteúdo, o que traz orçamento não é post institucional. É responder, por escrito, as perguntas que a ' +
            'pessoa faz antes de contratar: quanto custa em média, quanto tempo demora, o que costuma dar errado, como ' +
            'saber se o serviço foi bem feito. Uma página por serviço principal, com faixa de preço real e fotos de ' +
            'trabalhos seus. Falar de preço afasta curioso e atrai quem já decidiu contratar — é filtro, não perda.\n\n' +
            'Some a isso o recorte geográfico. Uma página por região que você atende de verdade, com conteúdo diferente ' +
            'em cada uma: referências locais, particularidades dos imóveis daquela área, trabalhos que você fez ali. ' +
            'Vinte páginas iguais trocando o nome do bairro é o padrão que as plataformas penalizam, e com razão. Três ' +
            'páginas honestas e específicas valem mais.\n\n' +
            'A rotina que sustenta tudo cabe em duas horas por mês: quatro fotos novas, uma publicação curta no perfil, ' +
            'todas as avaliações respondidas e conferência de que os dados continuam consistentes. Duas horas. O erro ' +
            'mais comum não é fazer errado, é fazer intensamente por três semanas e abandonar.\n\n' +
            'Fecho com a expectativa de prazo, para você não desistir cedo. Perfil arrumado dá efeito em duas a quatro ' +
            'semanas. Avaliações constantes começam a mudar o jogo no segundo mês. Conteúdo leva de dois a três meses ' +
            'para maturar. Nada disso é imediato, e nada disso é caro. É constância, e constância é justamente onde a ' +
            'sua concorrência falha.',
        },
      ],
    },
  },
];
