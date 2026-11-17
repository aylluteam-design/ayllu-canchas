# Prueba de punta a punta en modo demo (sin Supabase). Requiere: npm run build && npx vite preview --port 4173
from playwright.sync_api import sync_playwright
from datetime import date, timedelta
BASE='http://localhost:4173/'
res=[]; errores=[]
def ok(n,c,d=''): res.append((n,bool(c),d))
man=(date.today()+timedelta(days=1)).isoformat()
with sync_playwright() as p:
    b=p.chromium.launch(); ctx=b.new_context(viewport={'width':390,'height':860}); pg=ctx.new_page()
    pg.on('console',lambda m: errores.append(m.text) if m.type=='error' else None); pg.on('pageerror',lambda e: errores.append(str(e)))
    pg.goto(BASE); pg.wait_for_selector('[data-a=entrarDemo]')
    ok('Pantalla de acceso en modo demo', 'modo demostración' in pg.inner_text('#vista') and pg.locator('#badge').is_visible())
    pg.click('[data-a=entrarDemo]'); pg.wait_for_selector('.tabla-wrap')
    ok('Entra al panel y muestra agenda', pg.locator('nav').is_visible() and pg.locator('.res').count()>=2)
    ok('Pestaña Pendientes con contador', 'Pendientes (' in pg.inner_text('nav'))
    manifest=pg.evaluate("fetch('./manifest.webmanifest').then(r=>r.json())"); ok('Manifest PWA válido', manifest['display']=='standalone' and len(manifest['icons'])==3)
    ok('Íconos PWA existen', all(pg.evaluate(f"fetch('./{i['src']}').then(r=>r.ok)") for i in manifest['icons']))
    # dueño: enlace
    pg.click('nav [data-tab=enlace]'); url=pg.input_value('#enlace-url'); ok('Enlace del jugador #/r/demo', url.endswith('#/r/demo'), url)
    # jugador en otra pestaña (mismo navegador = mismos datos de demo)
    pj=ctx.new_page(); pj.on('pageerror',lambda e: errores.append(str(e))); pj.goto(BASE+'#/r/demo'); pj.wait_for_selector('.horas')
    ok('Vista del jugador sin nav ni salir', pj.locator('#nav').is_hidden() and pj.locator('#salir').is_hidden() and 'Reserva tu cancha' in pj.inner_text('#tit'))
    pj.click(f'[data-a=jDia][data-f="{man}"]')
    ok('20:00 ocupado (Halcones 20–22)', pj.locator('[data-a=jHora][data-h="20"]').is_disabled())
    ok('No ve nombres ajenos', 'Halcones' not in pj.inner_text('#vista') and 'Carlos' not in pj.inner_text('#vista'))
    pj.click('[data-a=jDur][data-d="2"]'); ok('2 h desde 19:00 no disponible', pj.locator('[data-a=jHora][data-h="19"]').is_disabled()); pj.click('[data-a=jDur][data-d="1"]')
    pj.click('[data-a=jHora][data-h="17"]'); pj.click('[data-a=jReservar]'); ok('Pide nombre', 'nombre' in pj.inner_text('#j-err').lower())
    pj.fill('#j-nombre','Luis Jugador'); pj.fill('#j-tel','12345'); pj.click('[data-a=jReservar]'); ok('Celular inválido rechazado','celular' in pj.inner_text('#j-err').lower())
    pj.fill('#j-tel','999 111 222'); pj.click('[data-a=jReservar]'); pj.wait_for_selector('#j-pague')
    ok('Reserva apartada con cuenta regresiva', 'Horario apartado' in pj.inner_text('#vista') and pj.locator('#vista [data-vence]').count()==1)
    href=pj.get_attribute('#j-pague','href'); ok('"Ya pagué" abre wa.me al dueño (51…)', href.startswith('https://wa.me/51987654321?text='), href[:60])
    ok('Muestra Yape', '987 654 321' in pj.inner_text('#vista'))
    # dueño ve la pendiente (refresco) y confirma
    pg.click('nav [data-tab=pend]'); pg.reload(); pg.click('[data-a=entrarDemo]'); pg.click('nav [data-tab=pend]')
    item=pg.locator('.item', has_text='Luis Jugador'); ok('Dueño ve la reserva del jugador', item.count()==1)
    item.locator('[data-a=confirmarSena]').click(); pg.wait_for_timeout(300)
    ok('Tras "Recibí la seña" sale de Pendientes', pg.locator('.item', has_text='Luis Jugador').count()==0)
    # el jugador ve la confirmación (sondeo de 5 s)
    pj.wait_for_function("document.body.innerText.includes('Reserva confirmada')", timeout=9000); ok('El jugador ve "Reserva confirmada" sin recargar', True)
    # choque del "+" del dueño
    pg.click('nav [data-tab=agenda]'); pg.click('[data-a=sem][data-d="0"]')
    cel=pg.locator(f'button.libre[data-fecha="{man}"][data-hora="19"]')
    if cel.count()==0: pg.click('[data-a=sem][data-d="7"]'); cel=pg.locator(f'button.libre[data-fecha="{man}"][data-hora="19"]')
    if cel.count():
        cel.click(); pg.select_option('#f-dur','2'); pg.fill('#f-nombre','Intruso'); pg.click('[data-a=guardarNueva]')
        ok('"+" del dueño no puede chocar', 'Choque' in pg.inner_text('#f-err'), pg.inner_text('#f-err')); pg.click('[data-a=cerrar]')
    # reserva manual válida
    cel=pg.locator(f'button.libre[data-fecha="{man}"][data-hora="16"]')
    if cel.count()==0: pg.click('[data-a=sem][data-d="7"]'); cel=pg.locator(f'button.libre[data-fecha="{man}"][data-hora="16"]')
    cel.click(); pg.fill('#f-nombre','Manual Uno'); pg.fill('#f-tel','988777666'); pg.click('[data-a=guardarNueva]'); pg.wait_for_timeout(300)
    ok('Reserva manual guardada', pg.locator('.res', has_text='Manual Uno').count()==1)
    # vencimiento y plazo
    pg.evaluate("""() => { const k='ayllu-canchas-demo-v4'; const d=JSON.parse(localStorage.getItem(k)); const r=d.reservas.find(x=>x.nombre==='Marcos Huamán'); r.venceEn=new Date(Date.now()-1000).toISOString(); localStorage.setItem(k,JSON.stringify(d)); }""")
    pg.reload(); pg.click('[data-a=entrarDemo]'); pg.click('nav [data-tab=pend]')
    ok('Reserva vencida se libera sola', 'Marcos' not in pg.inner_text('#vista') and 'Liberadas' in pg.inner_text('#vista'))
    # ajustes
    pg.click('nav [data-tab=config]'); pg.fill('#cfg-yape','911 000 111'); pg.dispatch_event('#cfg-yape','change'); pg.wait_for_timeout(300)
    pg.click('nav [data-tab=config]'); ok('Ajuste de Yape se guarda', pg.input_value('#cfg-yape')=='911 000 111')
    pg.select_option('#cfg-hini','18'); pg.wait_for_timeout(300); pg.click('nav [data-tab=agenda]'); ok('Horario de apertura 18:00 se refleja en la agenda', pg.locator('th.hora', has_text='17:00').count()==0)
    pg.click('nav [data-tab=config]'); pg.select_option('#cfg-hini','16'); pg.wait_for_timeout(300)
    # jugador: enlace inexistente en demo igual muestra demo; salir
    pg.click('#salir'); ok('Salir vuelve al acceso', pg.locator('[data-a=entrarDemo]').count()==1)
    # móvil sin scroll horizontal
    pg.click('[data-a=entrarDemo]')
    for tab in ['agenda','pend','manana','enlace','config']:
        pg.click(f'nav [data-tab={tab}]'); sw=pg.evaluate('document.documentElement.scrollWidth'); cw=pg.evaluate('document.documentElement.clientWidth'); ok(f'Móvil sin scroll horizontal: {tab}', sw<=cw, f'{sw}/{cw}')
    pj.reload(); pj.wait_for_selector('.horas'); sw=pj.evaluate('document.documentElement.scrollWidth'); ok('Móvil sin scroll horizontal: jugador', sw<=390, str(sw))
    ok('Jugador recuerda sus datos', pj.evaluate("localStorage.getItem('ayllu-canchas-jugador')").find('999111222')>0)
    ok('"Tus reservas" lista la confirmada', 'Tus reservas' in pj.inner_text('#vista'))
    b.close()
bad=[r for r in res if not r[1]]
for n,c,d in res: print('OK  ' if c else 'FALLA', n,'|',d)
print('Errores de consola:',errores); print(f'{len(res)-len(bad)}/{len(res)} OK')
