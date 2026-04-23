## Overview

This is a netbox plugin which offers a physical view of a device's module bays, onboard interfaces, frontports and backports.

When a module has been installed into a module bay the rendering will then display the modules port layout in the place where the module bay is defined.  This should work recursively if a module also has a module bay defined in it.

The plugin provides tab on a device type that provides the rendering of the layout module bays, onboard interfaces, frontports and backports as they are physically located.  

It also has a tab showing the same layout specifically for module types.  

This plugin provides a WYSIWYG interface for editing the design of the grid layout on the device types object and the modules type object.  the WYSIWYG display and editing interface will use Javascript and CSS to render and edit.

The information defining the layout is stored in json in the database.

On the device page when displaying the layout rendering including the installed modules and nested modules, the interface and port details will be reflected in the rendering.  Green being connected and a light grey being not connected and amber indicating a naming issue.

## Installation

Currently I have not made a pypi module and its just in dev mode.  I installed it using the following and might be specific to my environment:

```
gh repo clone dionrowney/netbox-devicelayout
cd /opt/netbox/netbox/
source /opt/netbox/netbox/venv/bin/activate
pip install -e /opt/netbox/netbox-devicelayout --no-deps
python manage.py migrate
source /opt/netbox/netbox/venv/bin/activate
python3 manage.py collectstatic
chmod -R 775 /opt/netbox/netbox-devicelayout/
chown -R root:root /opt/netbox/netbox-devicelayout/

```

## Example Screenshots
Layout view

<img width="1708" height="488" alt="Screenshot 2026-04-20 135810" src="https://github.com/user-attachments/assets/0e8c58f0-2b9d-4ef4-a9bd-4df4aa2ad965" />

Editor

<img width="1706" height="482" alt="Screenshot 2026-04-20 135846" src="https://github.com/user-attachments/assets/10100320-8c48-430b-b6e1-a157f7393354" />

<img width="1699" height="554" alt="Screenshot 2026-04-20 140006" src="https://github.com/user-attachments/assets/1c9451e6-4ba1-4c33-b6ae-ceac05135e94" />



