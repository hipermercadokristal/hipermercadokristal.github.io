update public.categorias
set departamento = 'Bebidas, Licores y Tabaco'
where departamento = 'Bebidas y Licores';

insert into public.categorias (nombre, departamento) values
  ('Víveres y Alacena', 'Víveres y Alacena'),
  ('Frutas y Verduras', 'Frutas y Verduras'),
  ('Carnes, Aves y Charcutería', 'Carnes, Aves y Charcutería'),
  ('Bebidas, Licores y Tabaco', 'Bebidas, Licores y Tabaco'),
  ('Snacks, Golosinas y Confitería', 'Snacks, Golosinas y Confitería'),
  ('Cuidado Personal e Higiene', 'Cuidado Personal e Higiene'),
  ('Cuidado del Hogar y Limpieza', 'Cuidado del Hogar y Limpieza'),
  ('Hogar, Bazar y Utensilios', 'Hogar, Bazar y Utensilios'),
  ('Electrodomésticos y Ferretería', 'Electrodomésticos y Ferretería'),
  ('Mascotas', 'Mascotas'),
  ('Congelados', 'Congelados')
on conflict (nombre) do update
set departamento = excluded.departamento;

update public.categorias
set departamento = 'Víveres y Alacena'
where nombre = 'Lácteos';

update public.productos
set updated_at = now()
where categoria_id in (
  select id from public.categorias
  where departamento = 'Bebidas, Licores y Tabaco'
     or nombre = 'Lácteos'
);
