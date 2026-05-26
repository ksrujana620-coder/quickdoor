// js/app.js — Quick door

const API_BASE_URL =
  window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://localhost:3000/api'
    : '/api';

let allProducts = [];
let currentCategory = 'all';
let currentSearch = '';

// ── Load products from API ─────────────────────────────────────────────────
async function loadProducts() {
  const grid = document.getElementById('productGrid');
  grid.innerHTML = '<p style="text-align:center;padding:60px;color:#7f8c8d;">Loading products...</p>';

  try {
    const res = await fetch(`${API_BASE_URL}/products`);
    if (!res.ok) throw new Error(`Server error ${res.status}`);
    allProducts = await res.json();
    renderProducts();
  } catch (err) {
    console.error('Load products error:', err);
    grid.innerHTML = `
      <div style="text-align:center;padding:60px;grid-column:1/-1;">
        <i class="fas fa-exclamation-triangle" style="font-size:40px;color:#e74c3c;"></i>
        <p style="margin-top:15px;color:#7f8c8d;">Could not load products. Please try again later.</p>
      </div>`;
  }
}

// ── Category filter (called from tab clicks) ───────────────────────────────
function filterCategory(category, el) {
  currentCategory = category;
  currentSearch = '';
  const searchInput = document.getElementById('searchInput');
  if (searchInput) searchInput.value = '';

  document.querySelectorAll('.category-tab').forEach(t => t.classList.remove('active'));
  if (el) el.classList.add('active');

  renderProducts();
}

// ── Search (called from input) ─────────────────────────────────────────────
function searchProducts() {
  const searchInput = document.getElementById('searchInput');
  currentSearch = searchInput ? searchInput.value.trim().toLowerCase() : '';

  if (currentSearch) {
    currentCategory = 'all';
    document.querySelectorAll('.category-tab').forEach(t => t.classList.remove('active'));
    const allTab = document.querySelector('[data-category="all"]');
    if (allTab) allTab.classList.add('active');
  }

  renderProducts();
}

// ── Render filtered products ───────────────────────────────────────────────
function renderProducts() {
  const grid = document.getElementById('productGrid');
  let filtered = allProducts;

  // Category filter — case-insensitive match
  if (currentCategory && currentCategory !== 'all') {
    filtered = filtered.filter(p => {
      const cat = Array.isArray(p.category)
        ? p.category.join(' ').toLowerCase()
        : (p.category || '').toLowerCase();
      return cat.includes(currentCategory.toLowerCase());
    });
  }

  // Search filter
  if (currentSearch) {
    filtered = filtered.filter(p => {
      const name = (p.name || '').toLowerCase();
      const cat  = Array.isArray(p.category)
        ? p.category.join(' ').toLowerCase()
        : (p.category || '').toLowerCase();
      return name.includes(currentSearch) || cat.includes(currentSearch);
    });
  }

  // Empty state
  if (filtered.length === 0) {
    const label = currentSearch
      ? `"${currentSearch}"`
      : currentCategory !== 'all'
        ? `<strong>${capitalise(currentCategory)}</strong>`
        : '';
    grid.innerHTML = `
      <div style="text-align:center;padding:60px;grid-column:1/-1;">
        <i class="fas fa-box-open" style="font-size:48px;color:#bdc3c7;"></i>
        <p style="margin-top:15px;color:#7f8c8d;">
          No ${label} products available yet.
        </p>
      </div>`;
    return;
  }

  grid.innerHTML = filtered.map(productCard).join('');
}

// ── Product card HTML ──────────────────────────────────────────────────────
function productCard(p) {
  const displayCategory = Array.isArray(p.category)
    ? p.category.join(', ')
    : (p.category || 'General');

  const icon = getCategoryIcon(displayCategory);
  const inStock = p.stock === undefined || p.stock > 0;

  return `
    <div class="product-card" onclick="viewProduct('${p.id}')" style="cursor:pointer;">
      <div style="position:relative;">
        <img
          src="${p.image || ''}"
          alt="${p.name}"
          onerror="this.src='https://placehold.co/300x200/e8f5e9/27ae60?text=${encodeURIComponent(p.name || 'Product')}'"
          style="width:100%;height:180px;object-fit:cover;border-radius:12px 12px 0 0;">
        <span style="position:absolute;top:10px;left:10px;background:rgba(39,174,96,0.9);color:white;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700;">
          ${icon} ${displayCategory}
        </span>
        ${!inStock ? `<span style="position:absolute;top:10px;right:10px;background:rgba(231,76,60,0.9);color:white;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700;">Out of Stock</span>` : ''}
      </div>
      <div style="padding:15px;">
        <h3 style="margin:0 0 6px;font-size:16px;color:#2c3e50;">${p.name}</h3>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px;">
          <span style="font-size:22px;font-weight:800;color:#27ae60;">₹${p.price}</span>
          <button
            class="btn"
            onclick="event.stopPropagation(); viewProduct('${p.id}')"
            ${!inStock ? 'disabled style="opacity:0.5;cursor:not-allowed;"' : ''}
            style="padding:8px 18px;font-size:13px;border-radius:25px;">
            ${inStock ? '<i class="fas fa-shopping-cart"></i> Order' : 'Unavailable'}
          </button>
        </div>
        ${p.stock !== undefined && inStock
          ? `<p style="font-size:11px;color:#95a5a6;margin:6px 0 0;">${p.stock} left in stock</p>`
          : ''}
      </div>
    </div>`;
}

// ── Go to product detail page ──────────────────────────────────────────────
function viewProduct(id) {
  localStorage.setItem('selectedProductId', id);
  window.location.href = 'product.html';
}

// ── Utilities ──────────────────────────────────────────────────────────────
function capitalise(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function getCategoryIcon(category) {
  const c = (category || '').toLowerCase();
  if (c.includes('grocery')) return '🛒';
  if (c.includes('sweet'))   return '🍬';
  if (c.includes('snack'))   return '🍎';
  if (c.includes('tiffin'))  return '🍱';
  if (c.includes('drink'))   return '🥤';
  return '📦';
}

// ── Init ───────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', loadProducts);
