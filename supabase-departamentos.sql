insert into public.categorias (nombre, departamento) values
  ('Víveres y Alacena', 'Víveres y Alacena'),
  ('Bebidas y Licores', 'Bebidas y Licores'),
  ('Cuidado del Hogar y Limpieza', 'Cuidado del Hogar y Limpieza')
on conflict (nombre) do update
set departamento = excluded.departamento;

update public.categorias
set departamento = 'Víveres y Alacena'
where nombre = 'Lácteos';

update public.productos
set updated_at = now()
where categoria_id = (
  select id from public.categorias where nombre = 'Lácteos'
);
