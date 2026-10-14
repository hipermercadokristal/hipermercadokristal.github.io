insert into public.categorias (nombre, departamento) values
  ('Víveres y Alacena', 'Víveres y Alacena'),
  ('Bebidas y Licores', 'Bebidas y Licores'),
  ('Cuidado del Hogar y Limpieza', 'Cuidado del Hogar y Limpieza')
on conflict (nombre) do update
set departamento = excluded.departamento;
