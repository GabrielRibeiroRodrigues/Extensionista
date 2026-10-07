// Dados mockados do cardápio. Cada categoria aponta para a cozinha que prepara.
// cozinha: null => item não vai para cozinha (servido no balcão/bar).

const loja = { nome: 'Bella Massa', subtitulo: 'Pizzaria & Cantina' };

const cozinhas = {
  1: { id: 1, nome: 'Cozinha 1', setor: 'Pizzas' },
  2: { id: 2, nome: 'Cozinha 2', setor: 'Massas' },
};

// Preço cheio do produto = Grande; os demais tamanhos aplicam o fator.
const tamanhos = [
  { id: 'B', nome: 'Broto', fatias: 4, fator: 0.6 },
  { id: 'M', nome: 'Média', fatias: 6, fator: 0.85 },
  { id: 'G', nome: 'Grande', fatias: 8, fator: 1 },
];

const categorias = [
  { id: 'pizzas', nome: 'Pizzas', cozinha: 1, temTamanho: true, meioAMeio: true },
  { id: 'pizzas-doces', nome: 'Pizzas Doces', cozinha: 1, temTamanho: true, meioAMeio: true },
  { id: 'massas', nome: 'Massas', cozinha: 2 },
  { id: 'bebidas', nome: 'Bebidas', cozinha: null },
];

const produtos = [
  { id: 'p1', categoria: 'pizzas', nome: 'Margherita', descricao: 'Molho, mussarela, tomate e manjericão', preco: 49.9 },
  { id: 'p2', categoria: 'pizzas', nome: 'Calabresa', descricao: 'Calabresa, cebola e azeitona', preco: 47.9 },
  { id: 'p3', categoria: 'pizzas', nome: 'Portuguesa', descricao: 'Presunto, ovo, cebola, ervilha e mussarela', preco: 54.9 },
  { id: 'p4', categoria: 'pizzas', nome: 'Quatro Queijos', descricao: 'Mussarela, provolone, parmesão e gorgonzola', preco: 56.9 },
  { id: 'p5', categoria: 'pizzas', nome: 'Frango com Catupiry', descricao: 'Frango desfiado e catupiry', preco: 52.9 },
  { id: 'p6', categoria: 'pizzas', nome: 'Pepperoni', descricao: 'Pepperoni e mussarela', preco: 58.9 },
  { id: 'd1', categoria: 'pizzas-doces', nome: 'Chocolate com Morango', descricao: 'Chocolate ao leite e morangos', preco: 46.9 },
  { id: 'd2', categoria: 'pizzas-doces', nome: 'Romeu e Julieta', descricao: 'Goiabada e queijo minas', preco: 42.9 },
  { id: 'm1', categoria: 'massas', nome: 'Espaguete à Bolonhesa', descricao: 'Molho de carne artesanal', preco: 39.9 },
  { id: 'm2', categoria: 'massas', nome: 'Fettuccine Alfredo', descricao: 'Molho branco, parmesão e manteiga', preco: 42.9 },
  { id: 'm3', categoria: 'massas', nome: 'Lasanha da Casa', descricao: 'Carne, presunto, queijo e molho branco', preco: 45.9 },
  { id: 'm4', categoria: 'massas', nome: 'Nhoque ao Sugo', descricao: 'Nhoque de batata com molho de tomate', preco: 36.9 },
  { id: 'm5', categoria: 'massas', nome: 'Penne ao Pesto', descricao: 'Pesto de manjericão e castanhas', preco: 38.9 },
  { id: 'b1', categoria: 'bebidas', nome: 'Refrigerante Lata', descricao: '350 ml', preco: 6.5 },
  { id: 'b2', categoria: 'bebidas', nome: 'Suco Natural', descricao: 'Laranja, limão ou abacaxi', preco: 9.9 },
  { id: 'b3', categoria: 'bebidas', nome: 'Água Mineral', descricao: '500 ml', preco: 4.5 },
];

function categoriaDoProduto(produto) {
  return categorias.find((c) => c.id === produto.categoria) || null;
}

function cozinhaDoProduto(produto) {
  const categoria = categoriaDoProduto(produto);
  return categoria ? categoria.cozinha : null;
}

// Arredonda para o "x,90" de cardápio: 29,94 -> 29,90; 42,41 -> 42,90.
function precoNoTamanho(produto, tamanhoId) {
  const tamanho = tamanhos.find((t) => t.id === tamanhoId);
  if (!tamanho || tamanho.fator === 1) return produto.preco;
  return Math.floor(produto.preco * tamanho.fator) + 0.9;
}

// Cardápio como a API entrega: pizzas já trazem o preço de cada tamanho.
function cardapioPublico() {
  return {
    loja,
    cozinhas,
    tamanhos: tamanhos.map(({ id, nome, fatias }) => ({ id, nome, fatias })),
    categorias,
    produtos: produtos.map((p) =>
      categoriaDoProduto(p).temTamanho
        ? { ...p, precos: Object.fromEntries(tamanhos.map((t) => [t.id, precoNoTamanho(p, t.id)])) }
        : p
    ),
  };
}

module.exports = {
  loja,
  cozinhas,
  tamanhos,
  categorias,
  produtos,
  categoriaDoProduto,
  cozinhaDoProduto,
  precoNoTamanho,
  cardapioPublico,
};
