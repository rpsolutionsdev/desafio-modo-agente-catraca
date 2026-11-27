const root = document.getElementById('app-root');
const header = document.getElementById('app-header');

if (header) {
  header.innerHTML = '<strong>Catraca</strong><span>Ambiente base ativo</span>';
}
if (root) {
  root.innerHTML = '<div class="card"><h1>Catraca</h1><p>Harness inicializado com sucesso.</p></div>';
}
