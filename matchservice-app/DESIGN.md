# VIBE MATCH — sistema visual

Referências de tom: **g4business.com** (navy profundo + dourado, tipografia serifada, cards de programa densos) e **grupoprimo.com.br** (preto quase absoluto, foto cinematográfica full-bleed, números gigantes).

A primeira versão do app usava uma paleta ametista/ciano neon. Ela lia como aplicativo de vida noturna e trabalhava contra o fato de que as pessoas entram aqui para fechar contrato. Toda a paleta foi trocada.

## Onde mexer

Um só arquivo: `lib/core/theme/vibe_match_theme.dart`. Nenhuma tela declara cor própria.

Os nomes dos tokens (`background`, `surface`, `neonPrimary`, `scoreGold`) foram mantidos de propósito mesmo com os valores todos trocados — assim cada tela já escrita contra eles herdou a nova identidade sem edição. **`neonPrimary` hoje é o dourado**, não mais ciano: é a única cor de "aja aqui" do app.

## Paleta

| Token | Valor | Uso |
|---|---|---|
| `ink` | `#050A0F` | Heros full-bleed e barra de navegação — o cromo some dentro da imagem |
| `background` | `#0B2237` | Fundo do app |
| `surface` | `#12314C` | Cards, sheets, inputs |
| `slate` | `#1D4763` | Faixas de seção |
| `cream` | `#F5F2EA` | Seções editoriais invertidas |
| `neonPrimary` | `#C9A46B` | **Dourado.** CTA primário, ícone ativo, ênfase |
| `scoreGold` | `#E3C48D` | Dourado claro — notas, K-Score |
| `textHigh` / `textLow` | `#F4F1EC` / `#9DB0C0` | Texto |
| `live` | `#E05B4A` | Selo "AO VIVO" |

## Tipografia

- **Playfair Display (serifada)** para display: hero, títulos de seção, números grandes. O corte **itálico em dourado** é reservado para a parte enfatizada de um título — duas ou três palavras, nunca uma segunda frase.
- **Inter** para tudo que é interface: corpo, botões, labels, tags.
- `eyebrow`: label curto, caixa alta, entreletra aberta, dourado — sempre acima do título de seção.
- `readingBody`: só para artigo longo (16px, entrelinha 1.72). Texto de leitura não é texto de interface.

## Componentes

Tudo em `lib/presentation/widgets/vibe_ui.dart`. **Componha a partir daí — não escreva padding, borda ou tipografia à mão, e não introduza cor nova.**

- `VibeContent` — limita a largura de leitura e aplica a goteira padrão. No build web impede que um parágrafo estique numa linha ilegível.
- `VibeSectionHeader` — eyebrow + título serifado com a ênfase em itálico dourado.
- `VibeStat` — número gigante com unidade pequena ("+13**MI**"). Dígitos tabulares, não tremem.
- `VibeCover` — capa de card. Renderiza a imagem quando existe e cai num **gradiente determinístico** derivado de uma semente estável (slug, id) quando não existe. Conteúdo entra em produção antes da arte; um retângulo cinza em cada card foi a maior razão da primeira versão parecer inacabada.
- `VibeCard`, `VibeTag`, `VibeRating`, `VibeCardRail`
- `VibeCinematicHero` — movimento contínuo procedural: dois focos de luz em órbita contrária sobre preto, mais um brilho diagonal lento. Lê como sala iluminada em vez de painel chapado.
- `VibeEmptyState` / `VibeErrorState` — todo estado vazio nomeia o que vai aparecer ali; todo erro tem "tentar de novo" que funciona.

### Sobre o vídeo de fundo

O pedido era "vídeos interativos no fundo, algo bem profissional". Um vídeo real exige um asset hospedado que ainda não temos, e um `<video>` que dá 404 fica muito pior que ausência de movimento — então `VibeCinematicHero` desenha o movimento em canvas. Não falha ao carregar e não custa banda.

Quando existir um clipe real: passe a URL por `--dart-define=HERO_VIDEO_URL` e troque o `CustomPaint` por um `VideoPlayer`. Todo o resto do layout continua igual.

## Marca

`lib/presentation/widgets/vibe_logo.dart`, desenhada em código (nítida em qualquer tamanho, recolorível sem segundo arquivo).

Dois triângulos se encontrando dentro de um losango: um sólido, um vazado. O produto é *dual opt-in* — só existe match quando os dois lados dizem sim — então a marca são duas metades que só fecham a forma juntas. No logotipo, "VIBE" no tom do texto e "MATCH" em dourado: a segunda palavra é a promessa.

## Regra que já quebrou o build

Os getters do `google_fonts` **não são `const`**. Uma coleção `const` contendo um widget estilizado com `VibeMatchTextStyles.*` não compila. Tire o `const` externo nesses casos.

## Verificação

O CI trava em qualquer aviso e o `dart format` difere entre versões de Dart. Use sempre o SDK fixado:

```
/opt/flutter-sdk/flutter/bin/flutter analyze                       # zero issues
/opt/flutter-sdk/flutter/bin/dart format lib
/opt/flutter-sdk/flutter/bin/dart format --set-exit-if-changed lib
/opt/flutter-sdk/flutter/bin/flutter build web --release
```
