## Overview

This is a netbox plugin which offers a physical view of a device's module bays, onboard interfaces, frontports and backports.

When a module has been installed into a module bay the rendering will then display the modules port layout in the place where the module bay is defined.  This should work recursively if a module also has a module bay defined in it.

The plugin provides tab on a device type that provides the rendering of the layout module bays, onboard interfaces, frontports and backports as they are physically located.  

It also has a tab showing the same layout specifically for module types.  

This plugin provides a WYSIWYG interface for editing the design of the grid layout on the device types object and the modules type object.  the WYSIWYG display and editing interface will use Javascript and CSS to render and edit.

The information defining the layout is stored in json in the database.

On the device page when displaying the layout rendering including the installed modules and nested modules, the interface and port details will be reflected in the rendering.  Green being connected and a light grey being not connected.
